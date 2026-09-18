require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');
const Razorpay = require('razorpay');

const app = express();
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must be set to at least 32 characters');
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'grand_palate',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true
});

app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(helmet({ contentSecurityPolicy: false, strictTransportSecurity: isProduction }));
app.use(express.json({ limit: '16kb', strict: true }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many login attempts. Try again later.' } });
const authLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false });
const assistantLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many assistant requests. Try again later.' } });
app.use('/api', apiLimiter);

const logSecurity = (event, request, details = {}) => {
  console.info(JSON.stringify({ timestamp: new Date().toISOString(), event, ip: request.ip, method: request.method, path: request.path, userId: request.user?.id || null, ...details }));
};
const hashToken = (token) => crypto.createHmac('sha256', sessionSecret).update(token).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('hex');
const safeEqual = (left, right) => {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const hashPassword = async (password, salt = crypto.randomBytes(16).toString('hex')) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, derivedKey) => {
    if (error) return reject(error);
    resolve(`${salt}:${derivedKey.toString('hex')}`);
  });
});

const verifyPassword = async (password, storedHash) => {
  const [salt, expected] = String(storedHash).split(':');
  if (!salt || !expected) return false;
  const actual = await hashPassword(password, salt);
  return safeEqual(actual.split(':')[1], expected);
};

const emailTransport = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000
}) : null;
const razorpay = process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : null;
const reservationFeePaise = 200;

async function sendAccountEmail(to, subject, text) {
  if (!emailTransport) {
    if (isProduction) throw new Error('Email delivery is not configured');
    console.warn(`Email delivery is not configured; development ${subject} email was not sent to ${to}`);
    return;
  }
  await emailTransport.sendMail({ from: process.env.EMAIL_FROM, to, subject, text });
}

function requiredText(value, field, maxLength = 255) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) throw new Error(`${field} is invalid`);
  return value.trim();
}
function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
function reservationInput(body) {
  const name = requiredText(body.name, 'Name', 120);
  const email = requiredText(body.email, 'Email', 254).toLowerCase();
  const phone = requiredText(body.phone, 'Phone', 30);
  const date = requiredText(body.date, 'Date', 10);
  const time = requiredText(body.time, 'Time', 5);
  const guests = Number(body.guests);
  const notes = body.notes === undefined ? '' : requiredText(body.notes, 'Notes', 1000);
  if (!validEmail(email) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !Number.isInteger(guests) || guests < 1 || guests > 30) {
    throw new Error('Please provide valid reservation details.');
  }
  return { name, email, phone, date, time, guests, notes };
}
function passwordValue(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) throw new Error('Password must be 12 to 128 characters');
  return value;
}
function sessionCookie(response, token) {
  response.cookie('gp_session', token, { httpOnly: true, secure: isProduction, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8, path: '/' });
}
async function createSession(userId, request, response) {
  const token = newToken();
  await pool.execute('INSERT INTO sessions (token_hash, user_id, expires_at, ip_address, user_agent) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 8 HOUR), ?, ?)', [hashToken(token), userId, request.ip, String(request.get('user-agent') || '').slice(0, 500)]);
  sessionCookie(response, token);
}
async function loadUser(request, response, next) {
  try {
    const token = request.cookies?.gp_session;
    if (!token) return next();
    const [rows] = await pool.execute('SELECT u.id, u.email, u.email_verified, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > NOW()', [hashToken(token)]);
    if (rows[0]) request.user = rows[0];
    return next();
  } catch (error) { return next(error); }
}
function requireVerifiedUser(request, response, next) {
  if (!request.user) return response.status(401).json({ error: 'Authentication required.' });
  if (!request.user.email_verified) return response.status(403).json({ error: 'Verify your email before continuing.' });
  return next();
}

function requireAdmin(request, response, next) {
  if (!request.user) return response.status(401).json({ error: 'Authentication required.' });
  if (!request.user.email_verified || request.user.role !== 'admin') return response.status(403).json({ error: 'Administrator access required.' });
  return next();
}
async function ownedReservation(request, response, next) {
  if (!/^\d+$/.test(request.params.id)) return response.status(404).json({ error: 'Reservation not found.' });
  const [rows] = await pool.execute('SELECT * FROM reservations WHERE id = ? AND user_id = ?', [request.params.id, request.user.id]);
  if (!rows[0]) return response.status(404).json({ error: 'Reservation not found.' });
  request.reservation = rows[0];
  return next();
}

app.use(require('cookie-parser')());
app.use(loadUser);

app.get('/verify-email', (request, response) => response.sendFile(path.join(__dirname, '..', 'frontend', 'verify-email.html')));

app.post('/api/auth/register', authLimiter, async (request, response) => {
  try {
    const email = requiredText(request.body.email, 'Email', 254).toLowerCase();
    const password = passwordValue(request.body.password);
    if (!validEmail(email)) return response.status(400).json({ error: 'Please provide a valid email address.' });
    const passwordHash = await hashPassword(password);
    const [result] = await pool.execute('INSERT INTO users (email, password_hash, email_verified) VALUES (?, ?, FALSE)', [email, passwordHash]);
    const token = newToken();
    await pool.execute('INSERT INTO email_verification_tokens (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))', [hashToken(token), result.insertId]);
    const verificationUrl = `${process.env.PUBLIC_APP_URL || ''}/verify-email?token=${token}`;
    logSecurity('account_created', request, { email });
    response.status(201).json({ message: 'Account created. Check your email to verify it.' });
    sendAccountEmail(email, 'Verify your Grand Palate account', `Verify your email by opening: ${verificationUrl}`)
      .catch((error) => console.error('Verification email failed to send:', error.message));
    return;
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return response.status(409).json({ error: 'Unable to create account with those details.' });
    logSecurity('account_creation_error', request, { error: error.message });
    return response.status(400).json({ error: 'Unable to create account.' });
  }
});

app.post('/api/auth/login', loginLimiter, async (request, response) => {
  try {
    const email = requiredText(request.body.email, 'Email', 254).toLowerCase();
    const password = passwordValue(request.body.password);
    const [rows] = await pool.execute('SELECT id, email, password_hash, email_verified, role FROM users WHERE email = ?', [email]);
    const user = rows[0];
    if (!user || !(await verifyPassword(password, user?.password_hash || 'invalid'))) {
      logSecurity('login_failed', request, { email });
      return response.status(401).json({ error: 'Invalid email or password.' });
    }
    if (!user.email_verified) return response.status(403).json({ error: 'Verify your email before signing in.' });
    await createSession(user.id, request, response);
    logSecurity('login_succeeded', request, { email });
    return response.json({ message: 'Signed in successfully.', role: user.role });
  } catch (error) {
    logSecurity('login_error', request, { error: error.message });
    return response.status(400).json({ error: 'Invalid login request.' });
  }
});

app.post('/api/auth/verify-email', authLimiter, async (request, response) => {
  try {
    const token = requiredText(request.body.token, 'Token', 128);
    const [rows] = await pool.execute('SELECT user_id FROM email_verification_tokens WHERE token_hash = ? AND expires_at > NOW()', [hashToken(token)]);
    if (!rows[0]) return response.status(400).json({ error: 'Invalid or expired verification token.' });
    await pool.execute('UPDATE users SET email_verified = TRUE WHERE id = ?', [rows[0].user_id]);
    await pool.execute('DELETE FROM email_verification_tokens WHERE token_hash = ?', [hashToken(token)]);
    return response.json({ message: 'Email verified successfully.' });
  } catch (error) { return response.status(400).json({ error: 'Invalid verification request.' }); }
});

app.post('/api/auth/resend-verification', authLimiter, async (request, response) => {
  const genericResponse = { message: 'If the account exists and is not verified, a new verification email has been sent.' };
  try {
    const email = requiredText(request.body.email, 'Email', 254).toLowerCase();
    if (!validEmail(email)) return response.json(genericResponse);
    const [rows] = await pool.execute('SELECT id, email_verified FROM users WHERE email = ?', [email]);
    if (rows[0] && !rows[0].email_verified) {
      const token = newToken();
      await pool.execute('DELETE FROM email_verification_tokens WHERE user_id = ?', [rows[0].id]);
      await pool.execute('INSERT INTO email_verification_tokens (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))', [hashToken(token), rows[0].id]);
      const verificationUrl = `${process.env.PUBLIC_APP_URL || ''}/verify-email?token=${token}`;
      sendAccountEmail(email, 'Verify your Grand Palate account', `Verify your email by opening: ${verificationUrl}`)
        .catch((error) => console.error('Resend verification email failed to send:', error.message));
    }
  } catch (error) { logSecurity('verification_resend_error', request, { error: error.message }); }
  return response.json(genericResponse);
});

app.post('/api/auth/request-password-reset', authLimiter, async (request, response) => {
  const genericResponse = { message: 'If an account exists, a password reset email has been sent.' };
  try {
    const email = requiredText(request.body.email, 'Email', 254).toLowerCase();
    if (!validEmail(email)) return response.json(genericResponse);
    const [rows] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
    if (rows[0]) {
      const token = newToken();
      await pool.execute('INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 MINUTE))', [hashToken(token), rows[0].id]);
      sendAccountEmail(email, 'Reset your Grand Palate password', `Reset your password by opening: ${process.env.PUBLIC_APP_URL || ''}/reset-password?token=${token}`)
        .catch((error) => console.error('Password reset email failed to send:', error.message));
    }
  } catch (error) { logSecurity('password_reset_request_error', request, { error: error.message }); }
  return response.json(genericResponse);
});

app.post('/api/auth/reset-password', authLimiter, async (request, response) => {
  try {
    const token = requiredText(request.body.token, 'Token', 128);
    const password = passwordValue(request.body.password);
    const [rows] = await pool.execute('SELECT user_id FROM password_reset_tokens WHERE token_hash = ? AND expires_at > NOW()', [hashToken(token)]);
    if (!rows[0]) return response.status(400).json({ error: 'Invalid or expired reset token.' });
    await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(password), rows[0].user_id]);
    await pool.execute('DELETE FROM password_reset_tokens WHERE token_hash = ?', [hashToken(token)]);
    await pool.execute('DELETE FROM sessions WHERE user_id = ?', [rows[0].user_id]);
    return response.json({ message: 'Password reset successfully.' });
  } catch (error) { return response.status(400).json({ error: 'Invalid password reset request.' }); }
});

app.post('/api/auth/logout', async (request, response) => {
  const token = request.cookies?.gp_session;
  if (token) await pool.execute('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
  response.clearCookie('gp_session', { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/' });
  return response.status(204).end();
});

app.get('/api/auth/me', requireVerifiedUser, (request, response) => response.json({ id: request.user.id, email: request.user.email, role: request.user.role }));
app.get('/api/admin/status', requireAdmin, (request, response) => response.json({ authorized: true, email: request.user.email }));

app.get('/api/health', async (request, response) => {
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    response.status(503).json({ status: 'error', database: 'unavailable' });
  }
});

app.post('/api/assistant', assistantLimiter, async (request, response) => {
  try {
    const message = requiredText(request.body.message, 'Message');
    const history = Array.isArray(request.body.history) ? request.body.history.slice(-6) : [];

    if (!process.env.GEMINI_API_KEY) {
      const normalizedMessage = message.toLowerCase();
      let reply = 'I can help with reservations, dining, the lounge, and private events. What would you like to know?';
      if (normalizedMessage.includes('reserve') || normalizedMessage.includes('book')) {
        reply = 'You can book a table from the Reservations page. Choose your date, time, and guest count, then our team will confirm availability.';
      } else if (normalizedMessage.includes('hour') || normalizedMessage.includes('open')) {
        reply = 'We are open Mon-Thu from 12pm to 11pm, Fri-Sat from 12pm to 1am, and Sunday from 11am to 11pm.';
      } else if (normalizedMessage.includes('party') || normalizedMessage.includes('event')) {
        reply = 'Our party hall supports celebrations, presentations, plated menus, and premium bar service. Visit the Party Hall page to enquire.';
      } else if (normalizedMessage.includes('menu') || normalizedMessage.includes('food')) {
        reply = 'Our menu brings together Indian, continental, and crafted beverage selections. Visit the Menu page to explore the current offering.';
      }
      return response.json({ reply, mode: 'fallback' });
    }

    const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
    const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: 'You are the concierge for The Grand Palate hotel and restaurant. Be concise, warm, and helpful. Only discuss reservations, menu, opening hours, lounge, party hall, and contact details. Never invent prices or availability; direct guests to the reservation form when booking is needed.' }]
        },
        contents: [
          ...history
            .filter((item) => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string' && item.content.length <= 500)
            .map((item) => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: item.content }] })),
          { role: 'user', parts: [{ text: message }] }
        ],
        generationConfig: { temperature: 0.4, maxOutputTokens: 250 }
      })
    });
    if (!aiResponse.ok) {
      const errorBody = await aiResponse.text();
      console.error('Gemini raw error body:', errorBody);
      throw new Error(`AI provider returned ${aiResponse.status}`);
    }
    const result = await aiResponse.json();
    const reply = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!reply) throw new Error('AI provider returned an empty response');
    return response.json({ reply, mode: 'ai' });
  } catch (error) {
    console.error('Assistant error:', error.message);
    return response.status(500).json({ error: 'The assistant is temporarily unavailable. Please use our contact form.' });
  }
});

app.post('/api/payments/order', apiLimiter, async (request, response) => {
  try {
    if (!razorpay) return response.status(503).json({ error: 'Payment service is not configured.' });
    const reservation = reservationInput(request.body);
    const order = await razorpay.orders.create({ amount: reservationFeePaise, currency: 'INR', receipt: `res_${newToken().slice(0, 24)}`, notes: { email: reservation.email } });

    await pool.execute(
      `INSERT INTO payment_orders
       (order_id, user_id, name, email, phone, reservation_date, reservation_time, guests, notes, amount_paise, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'created')`,
      [order.id, request.user?.id || null, reservation.name, reservation.email, reservation.phone, reservation.date, reservation.time, reservation.guests, reservation.notes, reservationFeePaise]
    );
    return response.status(201).json({ orderId: order.id, amount: reservationFeePaise, currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID });
  } catch (error) {
    logSecurity('payment_order_error', request, { error: error.message });
    return response.status(400).json({ error: 'Unable to start payment.' });
  }
});

app.post('/api/payments/verify', apiLimiter, async (request, response) => {
  const connection = await pool.getConnection();
  try {
    const orderId = requiredText(request.body.razorpay_order_id, 'Order', 50);
    const paymentId = requiredText(request.body.razorpay_payment_id, 'Payment', 50);
    const signature = requiredText(request.body.razorpay_signature, 'Signature', 128);
    const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
    if (!safeEqual(signature, expectedSignature)) return response.status(400).json({ error: 'Payment verification failed.' });

    await connection.beginTransaction();
    const [orders] = await connection.execute('SELECT * FROM payment_orders WHERE order_id = ? FOR UPDATE', [orderId]);
    const order = orders[0];
    if (!order || order.status !== 'created' || order.amount_paise !== reservationFeePaise) {
      await connection.rollback();
      return response.status(400).json({ error: 'Payment order is invalid or already processed.' });
    }
    const [result] = await connection.execute(
      `INSERT INTO reservations
       (name, email, phone, reservation_date, reservation_time, guests, notes, user_id, payment_order_id, payment_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [order.name, order.email, order.phone, order.reservation_date, order.reservation_time, order.guests, order.notes, order.user_id, orderId, paymentId]
    );
    await connection.execute('UPDATE payment_orders SET status = \'paid\', payment_id = ?, paid_at = NOW() WHERE order_id = ?', [paymentId, orderId]);
    await connection.commit();
    return response.status(201).json({ id: result.insertId, message: 'Payment received and reservation confirmed.' });
  } catch (error) {
    await connection.rollback();
    logSecurity('payment_verification_error', request, { error: error.message });
    return response.status(400).json({ error: 'Unable to verify payment.' });
  } finally { connection.release(); }
});

app.post('/api/payments/upi-confirmation', apiLimiter, async (request, response) => {
  try {
    const orderId = requiredText(request.body.order_id, 'Order', 50);
    const utr = requiredText(request.body.utr, 'UTR', 50);
    if (!/^[A-Za-z0-9-]{6,50}$/.test(utr)) return response.status(400).json({ error: 'Enter a valid UTR or transaction reference.' });
    const [result] = await pool.execute(
      `UPDATE payment_orders SET status = 'upi_pending', utr = ?
       WHERE order_id = ? AND status = 'created' AND amount_paise = ?`,
      [utr, orderId, reservationFeePaise]
    );
    if (!result.affectedRows) return response.status(400).json({ error: 'Payment order is invalid or already submitted.' });
    logSecurity('upi_payment_pending', request, { orderId });
    return response.status(202).json({ message: 'UPI payment submitted for verification. Your reservation will be confirmed after payment is checked.' });
  } catch (error) {
    logSecurity('upi_payment_error', request, { error: error.message });
    return response.status(400).json({ error: 'Unable to submit UPI payment details.' });
  }
});

app.post('/api/reservations', async (request, response) => {
  try {
    reservationInput(request.body);
    return response.status(402).json({ error: 'Payment is required to reserve a table.' });
  } catch (error) {
    return response.status(400).json({ error: error.message });
  }
});

app.get('/api/reservations/:id', requireVerifiedUser, ownedReservation, (request, response) => response.json(request.reservation));
app.delete('/api/reservations/:id', requireVerifiedUser, ownedReservation, async (request, response) => {
  await pool.execute('DELETE FROM reservations WHERE id = ? AND user_id = ?', [request.params.id, request.user.id]);
  return response.status(204).end();
});

app.post('/api/messages', async (request, response) => {
  try {
    const name = requiredText(request.body.name, 'Name', 120);
    const email = requiredText(request.body.email, 'Email', 254).toLowerCase();
    const subject = requiredText(request.body.subject, 'Subject', 200);
    const message = requiredText(request.body.message, 'Message', 5000);

    if (!validEmail(email)) {
      return response.status(400).json({ error: 'Please provide a valid email address.' });
    }

    const [result] = await pool.execute(
      `INSERT INTO messages (name, email, subject, message)
       VALUES (?, ?, ?, ?)`,
      [name, email, subject, message]
    );

    return response.status(201).json({
      id: result.insertId,
      message: 'Message sent successfully.'
    });
  } catch (error) {
    console.error('Message error:', error.message);
    logSecurity('message_error', request, { error: error.message });
    return response.status(400).json({ error: 'Unable to send message.' });
  }
});

app.use((error, request, response, next) => {
  logSecurity('api_error', request, { error: error.message });
  if (response.headersSent) return next(error);
  return response.status(500).json({ error: 'An internal error occurred.' });
});

app.listen(port, () => {
  console.log(`The Grand Palate server is running at http://localhost:${port}`);
});