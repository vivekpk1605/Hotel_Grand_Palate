const fs = require('node:fs');
const path = require('node:path');

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 54;
const MARGIN_TOP = 62;
const MARGIN_BOTTOM = 58;
const LINE_W = PAGE_W - MARGIN_X * 2;

const sections = [
  ['h1', 'The Grand Palate'],
  ['sub', 'Complete Project Documentation'],
  ['p', 'Hotel and restaurant web application for a luxury multi-cuisine venue in Bandra West, Mumbai. This document explains the architecture, every major user flow, how payments are collected and verified, and the security controls implemented in the current codebase.'],
  ['p', 'Brand: The Grand Palate (Est. 2010). Stack: static HTML/CSS/JavaScript frontend, Node.js + Express API, MySQL, Razorpay Checkout, optional SMTP email, and an optional OpenAI concierge. Version described: local project hotel_palate-main as of 16 September 2026.'],

  ['h2', '1. What the product does'],
  ['p', 'The site is a marketing and booking surface for dining, private events, and a lounge. Guests browse Home, Menu, Reservations, Party Hall, Lounge, and Contact. They can create an account, verify email, sign in, send a contact message, chat with an on-site assistant, and pay a small reservation deposit before a table is stored as confirmed.'],
  ['p', 'Administrators sign in with a user whose role is admin. The admin page only confirms that the session is an administrator; it is not a full back-office for orders or menus.'],
  ['bullet', 'Public brochure pages: cuisine story, opening hours, party hall, lounge, contact details.'],
  ['bullet', 'Account system: register, verify email, login, logout, password reset request, session cookie.'],
  ['bullet', 'Reservations: form data is not saved until payment succeeds (or a UPI reference is submitted for later check).'],
  ['bullet', 'Payments: Razorpay order creation, Checkout widget (UPI, card, netbanking, wallet), HMAC signature verification, then reservation insert.'],
  ['bullet', 'Contact messages stored in MySQL. AI concierge with OpenAI or a local keyword fallback.'],

  ['h2', '2. Folder layout and how the app is served'],
  ['p', 'The repository is split into frontend and backend. Express serves the frontend folder as static files from the same origin as the API. That matters for cookies: the gp_session cookie is first-party when the browser loads pages from the Node server (for example http://localhost:3000). Opening HTML as a file:// page or a separate static host will break login and payment verify calls unless a reverse proxy unifies the origin.'],
  ['code', 'hotel_palate-main/\n  frontend/     HTML pages, CSS in each page, JS widgets\n  backend/      server.js, schema.sql, .env, package.json\n  SECURITY.md   production hardening notes\n  docs/         this documentation generator and PDF'],
  ['p', 'Frontend files: index.html (home + sign-in gate), menu.html, reservation.html, partyhall.html, lounge.html, contact.html, auth.html, admin.html, payment.html, verify-email.html. Scripts: auth-modal.js, auth.js, form-handler.js, payment.js, chat-widget.js.'],
  ['p', 'Backend entry: backend/server.js. Start with npm start or npm run dev from backend after schema.sql is applied and .env is filled. Default port 3000. Health check: GET /api/health (SELECT 1 against MySQL).'],

  ['h2', '3. Architecture'],
  ['p', 'Browser pages never talk to MySQL. They call JSON APIs under /api. Express middleware order is important: Helmet headers, JSON body parser (16 KB max, strict JSON), static files, then cookie-parser, then loadUser (attach request.user from gp_session if valid), then route handlers, then a generic 500 handler that logs api_error without leaking stack traces to the client.'],
  ['p', 'MySQL is accessed with mysql2/promise connection pool (limit 10). Parameterized queries (placeholders ?) are used for user input to reduce SQL injection risk. Payment verification uses a dedicated connection, BEGIN, SELECT ... FOR UPDATE on the order row, insert reservation, update order to paid, COMMIT. Rollback on failure.'],
  ['p', 'Secrets live only in backend environment variables. Frontend receives Razorpay key_id (public) after an order is created. The Razorpay key_secret never ships in HTML or JS.'],

  ['h2', '4. Frontend pages in detail'],
  ['h3', '4.1 Home (index.html)'],
  ['p', 'Hero, cuisine cards (Indian, Italian, Chinese, Mexican), about stats, beverages, reservations / party hall / lounge teasers, footer. Scripts: chat-widget.js and auth-modal.js. The sign-in modal is a gate: if GET /api/auth/me is not OK, the dialog opens and cannot be dismissed with close, Escape, or backdrop click. The guest must submit email and password. Successful login redirects admin users to /admin.html and everyone else to /index.html. If already signed in, the modal stays hidden.'],
  ['h3', '4.2 Menu, Lounge, Party Hall'],
  ['p', 'Content pages with the same navigation. Chat widget is included. Sign in links go to auth.html on these pages (the modal script is currently only on the home page). Party hall describes private events; lounge describes the upper-floor beverage and music space.'],
  ['h3', '4.3 Reservations (reservation.html)'],
  ['p', 'Form fields: name, email, phone, date, time (select), guests (select), optional notes. form-handler.js intercepts submit. Because the form sits in .reservation-form, the client POSTs JSON to /api/payments/order, not directly to /api/reservations. On success it navigates to payment.html with query parameters order_id, amount, currency, key_id.'],
  ['h3', '4.4 Payment (payment.html + payment.js)'],
  ['p', 'Shows a deposit of Rs 2.00 (200 paise). Pay securely loads Razorpay Checkout. If query params are missing, amount is not 200, currency is not INR, or the Checkout script failed, the button is disabled. After the guest pays, Checkout calls handler with razorpay_order_id, razorpay_payment_id, razorpay_signature. The page POSTs those to /api/payments/verify. Success copy: Payment received and reservation confirmed. Dismissing Checkout sets Payment was cancelled and re-enables the button. A reservation is not created on cancel.'],
  ['h3', '4.5 Contact'],
  ['p', 'Form name, email, subject, message. form-handler.js POSTs /api/messages. Success message is shown; the form resets. No payment involved.'],
  ['h3', '4.6 Auth page (auth.html)'],
  ['p', 'Standalone sign-in / create-account page using auth.js. Same API as the modal. Useful for admin redirect and pages that do not load auth-modal.js. Forgot password links to /reset-password (route is not implemented as a dedicated HTML page in the frontend folder; the API for requesting and completing reset exists).'],
  ['h3', '4.7 Verify email'],
  ['p', 'Reads token from the URL, POSTs /api/auth/verify-email, then offers a return link.'],
  ['h3', '4.8 Admin'],
  ['p', 'GET /api/admin/status with cookies. If not admin, after a short delay redirects to /auth.html. Logout POSTs /api/auth/logout and returns to auth.'],

  ['h2', '5. Authentication and accounts'],
  ['p', 'Users table: email (unique, max 254), password_hash, email_verified (false until the mail link is used), role enum user or admin (default user). Admin is not self-serve; it must be set in the database.'],
  ['h3', '5.1 Registration'],
  ['p', 'POST /api/auth/register. Email lowercased. Password 12 to 128 characters. Password hashed with scrypt (N=16384, r=8, p=1, 64-byte key) plus a 16-byte random salt, stored as salt:hex. A 32-byte random verification token is created; only HMAC-SHA256(token, SESSION_SECRET) is stored. The raw token is emailed as PUBLIC_APP_URL/verify-email?token=... Duplicate emails return a generic 409 so the API does not confirm which addresses exist, aside from the wording Unable to create account with those details.'],
  ['h3', '5.2 Email verification'],
  ['p', 'POST /api/auth/verify-email. Token must match a non-expired row (24 hours). User email_verified is set true and the token row is deleted. Resend: POST /api/auth/resend-verification always returns the same message whether or not the account exists, to limit account enumeration. Old verification tokens for that user are deleted before issuing a new one.'],
  ['h3', '5.3 Login'],
  ['p', 'POST /api/auth/login, extra limiter: 10 attempts per 15 minutes per IP. Password is verified with scrypt and timing-safe compare. Missing users still run verify against a dummy hash path conceptually by failing verifyPassword. Unverified accounts get 403 Verify your email before signing in. Success creates a session row and Set-Cookie gp_session.'],
  ['h3', '5.4 Sessions'],
  ['p', 'Raw session token: 32 random bytes hex. Stored value: HMAC-SHA256 with SESSION_SECRET (64 hex chars). Cookie flags: httpOnly (JavaScript cannot read it), sameSite=lax, path=/, maxAge 8 hours, secure=true only when NODE_ENV=production. Session row also stores IP and user-agent snapshot. loadUser joins sessions to users where expires_at is in the future. Logout deletes that token hash and clears the cookie. Password reset deletes ALL sessions for that user so stolen cookies die after a reset.'],
  ['h3', '5.5 Password reset'],
  ['p', 'POST /api/auth/request-password-reset always returns a generic success-style message. If the user exists, a 30-minute token is stored (hashed) and emailed to PUBLIC_APP_URL/reset-password?token=... POST /api/auth/reset-password sets a new scrypt hash, deletes the reset token, and wipes sessions.'],
  ['h3', '5.6 Authorization helpers'],
  ['p', 'requireVerifiedUser: 401 if no session, 403 if email not verified. requireAdmin: must be verified and role admin. ownedReservation: reservation id must be digits and belong to request.user.id, else 404 (does not leak other people\'s bookings). GET/DELETE /api/reservations/:id use these guards. Creating a reservation through the unpaid POST /api/reservations always returns 402 Payment is required to reserve a table.'],

  ['h2', '6. Payments — end-to-end'],
  ['p', 'Business rule: a table is not confirmed until money is verified. The deposit amount is hardcoded as reservationFeePaise = 200, which is 200 paise = Rs 2.00 INR. That amount is a technical minimum suitable for Razorpay test mode, not a production restaurant deposit. Change the constant and the frontend checks together if you raise the fee.'],
  ['h3', '6.1 Why Razorpay'],
  ['p', 'Card, UPI, netbanking, and wallets are collected on Razorpay-hosted Checkout. The site never sees full card numbers or UPI PINs. The server only creates an Order and later verifies the payment signature with the merchant secret.'],
  ['h3', '6.2 Step 1 — Create order'],
  ['p', 'Guest submits the reservation form. Server validates name (max 120), email, phone (max 30), date YYYY-MM-DD, time HH:MM, guests integer 1-30, notes max 1000. If RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are missing, API returns 503 Payment service is not configured.'],
  ['p', 'razorpay.orders.create is called with amount 200, currency INR, a unique receipt res_<random>, and notes.email. The Razorpay order id plus guest details are inserted into payment_orders with status created, amount_paise 200, optional user_id if signed in. Response 201: orderId, amount, currency, keyId (publishable).'],
  ['h3', '6.3 Step 2 — Checkout in the browser'],
  ['p', 'payment.js constructs Razorpay({ key, amount, currency, order_id, name The Grand Palate, description Table reservation deposit }). Methods: upi, card, netbanking, wallet. Display config prefers a UPI block first but still shows default blocks. The guest completes payment on Razorpay. Checkout returns payment ids and a signature. No reservation row exists yet.'],
  ['h3', '6.4 Step 3 — Verify signature (the important security step)'],
  ['p', 'POST /api/payments/verify body: razorpay_order_id, razorpay_payment_id, razorpay_signature. The server computes HMAC-SHA256 of orderId|paymentId using RAZORPAY_KEY_SECRET and compares with crypto.timingSafeEqual. If a client faked a payment id without paying, the HMAC will not match and the API returns Payment verification failed. Never trust Checkout success alone without this check.'],
  ['p', 'If the HMAC is valid, a transaction locks the payment_orders row FOR UPDATE. The row must exist, status must still be created, and amount_paise must still equal 200. That blocks replay: a second verify cannot insert a second reservation for the same paid order. Then INSERT reservations copying guest fields plus payment_order_id and payment_id, UPDATE payment_orders to status paid, payment_id, paid_at=NOW(), COMMIT. Response 201 with reservation id and confirmation text.'],
  ['h3', '6.5 Alternate path — UPI reference without Checkout verify'],
  ['p', 'POST /api/payments/upi-confirmation accepts order_id and utr (6-50 alphanumeric or hyphen). If the order is still created and amount matches, status becomes upi_pending and utr is stored. HTTP 202: reservation will be confirmed after payment is checked. This path does NOT insert into reservations and does not talk to Razorpay. It is a manual-review holding state. The current payment.html UI does not call this endpoint; Checkout verify is the live guest path. Staff would need a separate process to mark upi_pending orders paid.'],
  ['h3', '6.6 Payment_orders status machine'],
  ['bullet', 'created — Razorpay order exists, guest has not completed a verified payment.'],
  ['bullet', 'upi_pending — guest submitted a UTR; waiting for human or ops confirmation (no auto-reservation).'],
  ['bullet', 'paid — HMAC verified; reservation row created; paid_at set.'],
  ['bullet', 'failed — enum exists for future use; verify/UPI handlers do not currently set failed on cancel.'],
  ['h3', '6.7 What is stored vs not stored'],
  ['p', 'Stored: Razorpay order_id, payment_id after success, amount in paise, guest contact and booking slot, optional UTR. Not stored: card PAN, CVV, UPI PIN, full Checkout payloads. PCI scope stays with Razorpay. The publishable key_id in the query string is expected for Checkout; the secret stays on the server.'],
  ['h3', '6.8 Frontend amount check'],
  ['p', 'payment.js requires amount === 200. A tampered query string cannot lower the charged amount because Razorpay charges the server-created order, and verify re-reads amount_paise from the database. Tampering the query only breaks the button or shows a mismatch; it cannot confirm a reservation without a matching paid order.'],

  ['h2', '7. Reservations and contact data'],
  ['p', 'reservations columns: name, email, phone, reservation_date, reservation_time, guests, notes, optional user_id (SET NULL if user deleted), payment_order_id unique, payment_id, created_at. A signed-in guest has user_id copied from the payment order at verify time. Anonymous guests can still pay; user_id is null.'],
  ['p', 'GET /api/reservations/:id returns the row only to the owning verified user. DELETE removes only that user\'s row. There is no public list of all bookings. messages table stores contact form submissions (name, email, subject, message, optional user_id unused in the current insert).'],

  ['h2', '8. AI concierge'],
  ['p', 'chat-widget.js is a floating Ask AI panel. History is kept in the browser (last messages sent with the request; server keeps only the last 6). POST /api/assistant, limiter 20 requests / 15 minutes. Message required; history items must be role user or assistant and content length <= 500. If OPENAI_API_KEY is empty, a keyword fallback answers reserve/book, hours/open, party/event, menu/food, else a generic line. Mode in JSON is fallback or ai.'],
  ['p', 'With a key, the server calls OPENAI_API_URL (default OpenAI chat completions) with model OPENAI_MODEL (default gpt-4o-mini), temperature 0.4, max_tokens 250. System prompt: concierge for The Grand Palate; only reservations, menu, hours, lounge, party hall, contact; never invent prices or availability. Failures return 500 with a generic error. The widget displays assistant text with textContent (not innerHTML), which avoids HTML injection from model output in the chat bubble.'],

  ['h2', '9. Security methods in depth'],
  ['h3', '9.1 Transport and headers'],
  ['p', 'X-Powered-By is disabled. Helmet is enabled (CSP is currently off so inline scripts and Razorpay CDN can run; HSTS is on only in production). Production should sit behind TLS-terminating reverse proxy. TRUST_PROXY=true only when the proxy sets client IP correctly, otherwise rate limits and session IP logs can be spoofed or pinned to the proxy.'],
  ['h3', '9.2 Secrets and configuration'],
  ['p', 'SESSION_SECRET must be at least 32 characters or the process refuses to start. Used as HMAC key for session, email verify, and password-reset tokens so a stolen database of hashes is not enough to reconstruct the raw tokens without the secret. Database password, SMTP password, OpenAI key, Razorpay secret belong in environment or a secret manager, never in frontend files or git. SECURITY.md tells operators not to run MySQL as a public root account.'],
  ['h3', '9.3 Password storage'],
  ['p', 'scrypt is a memory-hard KDF. Salt is per-user. Timing-safe comparison avoids leaking how many hash bytes matched. Length policy 12-128 reduces trivial passwords; there is no complexity regex beyond length. Plain passwords are not logged.'],
  ['h3', '9.4 Token hashing'],
  ['p', 'Email verify, password reset, and session identifiers are stored as HMAC-SHA256 hex, not as the token sent to the user. A database dump of token_hash values cannot be used as cookies or links without SESSION_SECRET (and even then HMAC is not designed to reverse). Tokens are high-entropy crypto.randomBytes(32).'],
  ['h3', '9.5 Cookies'],
  ['p', 'httpOnly blocks XSS from reading the session cookie via document.cookie. sameSite=lax reduces CSRF on cross-site POSTs from other sites (top-level GET navigations still send the cookie). secure in production requires HTTPS. 8-hour absolute expiry. Logout and password reset invalidate server-side rows, not only the browser cookie.'],
  ['h3', '9.6 CSRF and same origin'],
  ['p', 'There is no separate CSRF token. Protection relies on SameSite=lax cookies plus JSON APIs that are not simple form posts from other origins (CORS is not opened to arbitrary sites). If the frontend is hosted on another domain, cookies will not attach and you would need an explicit CORS and CSRF design. Keep API and pages on one origin as the code assumes.'],
  ['h3', '9.7 Injection and validation'],
  ['p', 'JSON body limit 16kb. Strict JSON parsing. requiredText rejects non-strings, empty trim, and over-max length. Email regex is basic. Dates and times are regex-checked. Reservation guests capped at 30. SQL uses bound parameters. Assistant history is filtered by role and length. Chat UI uses textContent. Generic error messages on auth failures and many 400s reduce oracle leaks; login still distinguishes unverified email after a correct-looking login path.'],
  ['h3', '9.8 Rate limiting'],
  ['bullet', 'All /api: 120 requests / 15 minutes (express-rate-limit draft-8 headers).'],
  ['bullet', 'Login: 10 / 15 minutes (credential stuffing resistance).'],
  ['bullet', 'Register, verify, resend, password reset: 10 / 60 minutes.'],
  ['bullet', 'Assistant: 20 / 15 minutes (cost and abuse).'],
  ['bullet', 'Payment order/verify/UPI also sit behind the global /api limiter.'],
  ['h3', '9.9 Payment security'],
  ['p', 'Server-side amount, HMAC verification, row lock, single-use created status, no card data at rest. Do not confirm reservations from client-only success events. Rotate RAZORPAY_KEY_SECRET if leaked; old signatures would still verify until Razorpay rotates the key pair. Use rzp_test_ keys in development and live keys only in production with HTTPS.'],
  ['h3', '9.10 Privacy and logging'],
  ['p', 'logSecurity writes JSON lines: timestamp, event, ip, method, path, userId, plus extra fields such as email on login. Useful for alerts; treat logs as sensitive. Do not log passwords, Razorpay signatures, or full payment objects. Emails contain raw tokens; HTTPS on PUBLIC_APP_URL and SMTP auth matter. In development without SMTP, verification emails are skipped with a console warning; production throws if SMTP is missing so accounts cannot be created without a verification channel.'],
  ['h3', '9.11 Account enumeration'],
  ['p', 'Resend verification and password-reset request use the same response whether the email exists. Registration duplicate is slightly less generic (409). Login uses Invalid email or password for bad credentials.'],
  ['h3', '9.12 Known gaps (honest)'],
  ['p', 'Content-Security-Policy is disabled, so XSS in any inline or third-party script has a wider blast radius. There is no CSRF token for same-site JSON posts. Admin role is a DB flag with no audit UI. UPI pending is not auto-reconciled. reset-password HTML page is not in the frontend list. Home sign-in gate does not apply to every HTML page. Cookie-parser is mounted after static middleware (API still works). No captcha on register or contact. OpenAI key if present is a server-side secret but prompt injection can still make the model ignore the system prompt; the fallback and the instruction not to invent prices are mitigations, not guarantees.'],

  ['h2', '10. Database schema summary'],
  ['p', 'users: id, email unique, password_hash, email_verified, role user|admin, created_at.'],
  ['p', 'sessions: token_hash PK, user_id FK cascade delete, expires_at, ip_address, user_agent, created_at.'],
  ['p', 'email_verification_tokens / password_reset_tokens: token_hash PK, user_id, expires_at.'],
  ['p', 'payment_orders: order_id PK (Razorpay id), guest fields, amount_paise, status, payment_id, utr, paid_at, user_id optional.'],
  ['p', 'reservations: booking fields plus payment_order_id unique and payment_id after pay.'],
  ['p', 'messages: contact inbox. Apply backend/schema.sql on a dedicated app account. Existing databases can use backend/migration-add-payments.sql to add payment columns and the payment_orders table.'],

  ['h2', '11. API catalogue'],
  ['bullet', 'GET /api/health — DB ping.'],
  ['bullet', 'POST /api/auth/register — create user, send verify mail.'],
  ['bullet', 'POST /api/auth/login — session cookie.'],
  ['bullet', 'POST /api/auth/verify-email — token in body.'],
  ['bullet', 'POST /api/auth/resend-verification — email body.'],
  ['bullet', 'POST /api/auth/request-password-reset — email body.'],
  ['bullet', 'POST /api/auth/reset-password — token + new password.'],
  ['bullet', 'POST /api/auth/logout — 204.'],
  ['bullet', 'GET /api/auth/me — current verified user.'],
  ['bullet', 'GET /api/admin/status — admin only.'],
  ['bullet', 'POST /api/assistant — chat.'],
  ['bullet', 'POST /api/payments/order — start Razorpay order from reservation fields.'],
  ['bullet', 'POST /api/payments/verify — HMAC, create reservation.'],
  ['bullet', 'POST /api/payments/upi-confirmation — store UTR, upi_pending.'],
  ['bullet', 'POST /api/reservations — always 402 if body valid.'],
  ['bullet', 'GET/DELETE /api/reservations/:id — owner only.'],
  ['bullet', 'POST /api/messages — contact form.'],
  ['bullet', 'GET /verify-email — serves verify-email.html.'],

  ['h2', '12. Environment variables'],
  ['p', 'Copy backend/.env.example to backend/.env. PORT, NODE_ENV, SESSION_SECRET (32+ random chars), PUBLIC_APP_URL (real HTTPS origin in production), TRUST_PROXY, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, OPENAI_API_KEY optional, OPENAI_MODEL, OPENAI_API_URL, SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET. Never commit a filled .env. Rotate all secrets if a copy leaks.'],

  ['h2', '13. How to run locally'],
  ['bullet', 'Install MySQL. Create database grand_palate. Run schema.sql as a least-privilege user.'],
  ['bullet', 'cd backend && npm install. Fill .env including SESSION_SECRET and Razorpay test keys if you need payments.'],
  ['bullet', 'npm start. Open http://localhost:3000 (not a random static port, or cookies and /api paths will fail).'],
  ['bullet', 'Register, complete email verify (or set email_verified=1 in MySQL in a private lab only), sign in, submit a reservation, pay in Razorpay test Checkout, confirm the reservations row.'],
  ['bullet', 'To make an admin: UPDATE users SET role=\'admin\' WHERE email=\'you@example.com\'; then sign in and open /admin.html.'],

  ['h2', '14. Production checklist'],
  ['p', 'Follow SECURITY.md: private MySQL, TLS at the proxy, NODE_ENV=production, unique SESSION_SECRET, SMTP working, PUBLIC_APP_URL exact origin, firewall so only the app reaches MySQL, live Razorpay keys, raise reservationFeePaise if Rs 2 is only for tests, turn on HSTS via Helmet in production, consider enabling a CSP that still allows checkout.razorpay.com, structured log shipping, backup MySQL, and rotate secrets after incidents.'],

  ['h2', '15. Guest journeys (quick reference)'],
  ['p', 'Browse home: modal asks for login unless session exists. Create account: register, email link, then login. Book a table: fill reservation, server creates Razorpay order and payment_orders row, Checkout, verify HMAC, reservations row status paid. Cancel Checkout: no reservation. Contact: message stored immediately. Ask AI: widget to /api/assistant. Admin: role flag plus /api/admin/status.'],

  ['h2', '16. Document scope'],
  ['p', 'This PDF describes the application as implemented in this repository. It is not Razorpay legal documentation, PCI-DSS certification, or a penetration-test report. Payment amounts, SMTP, and AI behaviour depend on environment configuration. Keep secrets out of copies of this file if you paste live key names from a private .env.']
];

function wrapLine(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function escapePdf(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildPages() {
  const pages = [];
  let y = PAGE_H - MARGIN_TOP;
  let items = [];

  const flush = () => {
    pages.push(items);
    items = [];
    y = PAGE_H - MARGIN_TOP;
  };

  const need = (h) => {
    if (y - h < MARGIN_BOTTOM) flush();
  };

  const addText = (text, size, leading, font, extraGap = 0) => {
    const maxChars = font === 'F2' ? Math.floor(LINE_W / (size * 0.52)) : Math.floor(LINE_W / (size * 0.48));
    const wrapped = String(text).includes('\n')
      ? String(text).split('\n').flatMap((line) => wrapLine(line, Math.max(40, maxChars)))
      : wrapLine(text, Math.max(40, maxChars));
    for (const line of wrapped) {
      need(leading);
      items.push({ text: line, size, font, y });
      y -= leading;
    }
    y -= extraGap;
  };

  for (const [kind, text] of sections) {
    if (kind === 'h1') {
      addText(text, 22, 26, 'F2', 4);
    } else if (kind === 'sub') {
      addText(text, 12, 16, 'F2', 10);
    } else if (kind === 'h2') {
      y -= 8;
      need(36);
      addText(text, 14, 18, 'F2', 6);
    } else if (kind === 'h3') {
      y -= 4;
      need(28);
      addText(text, 12, 16, 'F2', 4);
    } else if (kind === 'bullet') {
      addText(`•  ${text}`, 10, 13, 'F1', 2);
    } else if (kind === 'code') {
      y -= 4;
      addText(text, 9, 12, 'F1', 8);
    } else {
      addText(text, 10, 13.5, 'F1', 8);
    }
  }
  if (items.length) flush();
  return pages;
}

function pageStream(items, pageNo, pageCount) {
  const ops = ['BT'];
  let lastFont = '';
  let lastSize = 0;
  for (const item of items) {
    if (item.font !== lastFont || item.size !== lastSize) {
      ops.push(`/${item.font} ${item.size} Tf`);
      lastFont = item.font;
      lastSize = item.size;
    }
    ops.push(`1 0 0 1 ${MARGIN_X.toFixed(2)} ${item.y.toFixed(2)} Tm`);
    ops.push(`(${escapePdf(item.text)}) Tj`);
  }
  ops.push('/F1 8 Tf');
  ops.push(`1 0 0 1 ${MARGIN_X.toFixed(2)} 32 Tm`);
  ops.push(`(${escapePdf(`The Grand Palate  ·  Project documentation  ·  Page ${pageNo} of ${pageCount}`)}) Tj`);
  ops.push('ET');
  return Buffer.from(ops.join('\n'), 'utf8');
}

function buildPdf(pages) {
  const objects = [];
  const add = (raw) => {
    objects.push(raw);
    return objects.length;
  };

  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const f1 = 1;
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const f2 = 2;

  const contentIds = [];
  const pageIds = [];
  const streams = pages.map((items, i) => pageStream(items, i + 1, pages.length));

  for (const stream of streams) {
    contentIds.push(add(`<< /Length ${stream.length} >>\nstream\n${stream.toString('utf8')}\nendstream`));
  }

  const kidsPlace = objects.length + 1;
  const pagesObjId = kidsPlace + streams.length;
  for (let i = 0; i < streams.length; i++) {
    pageIds.push(add(`<< /Type /Page /Parent ${pagesObjId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`));
  }
  add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesObjId} 0 R >>`);

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

const out = path.join(__dirname, '..', 'The-Grand-Palate-Project-Documentation.pdf');
fs.writeFileSync(out, buildPdf(buildPages()));
console.log(`Wrote ${out}`);
