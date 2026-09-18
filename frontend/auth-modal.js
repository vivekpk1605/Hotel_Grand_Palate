(() => {
  const style = document.createElement('style');
  style.textContent = `
    .auth-modal-backdrop{position:fixed;inset:0;z-index:2000;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.78);backdrop-filter:blur(8px)}
    .auth-modal{position:relative;width:min(440px,100%);border:1px solid #383631;background:#181715;color:#f2ead7;padding:38px;box-shadow:0 24px 80px rgba(0,0,0,.55);font-family:Jost,sans-serif}
    .auth-modal h2{margin:0 0 8px;color:#f2ead7;font:600 2.3rem 'Cormorant Garamond',serif}.auth-modal p{color:#aaa;line-height:1.6}.auth-modal label{display:block;margin:16px 0 7px;font-size:.8rem;color:#f2ead7}.auth-modal input{width:100%;padding:12px 14px;border:1px solid #383631;background:#0d0d0c;color:#f2ead7;font:1rem Jost;box-sizing:border-box}.auth-modal input:focus{outline:2px solid #c9a84c;outline-offset:1px}.auth-modal-tabs{display:flex;gap:24px;margin:25px 0 20px;border-bottom:1px solid #383631}.auth-modal-tabs button{padding:0 0 11px;border:0;border-bottom:2px solid transparent;background:transparent;color:#aaa;cursor:pointer;font:500 .78rem Jost;letter-spacing:1px;text-transform:uppercase}.auth-modal-tabs button.active{border-color:#c9a84c;color:#c9a84c}.auth-modal-submit{width:100%;margin-top:22px;padding:14px;border:0;background:#c9a84c;color:#111;cursor:pointer;font:500 .78rem Jost;letter-spacing:2px;text-transform:uppercase}.auth-modal-submit:disabled{opacity:.55;cursor:wait}.auth-modal-status{min-height:24px;margin-bottom:0;font-size:.88rem}.auth-modal[hidden],.auth-modal-backdrop[hidden]{display:none}
  `;
  document.head.appendChild(style);

  const backdrop = document.createElement('div');
  backdrop.className = 'auth-modal-backdrop';
  backdrop.hidden = true;
  backdrop.innerHTML = `
    <section class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title">
      <h2 id="auth-modal-title">Sign in</h2>
      <p class="auth-modal-intro">Enter your email and password to continue to the site.</p>
      <div class="auth-modal-tabs" role="tablist" aria-label="Account actions">
        <button class="active" type="button" data-modal-mode="login">Sign in</button>
        <button type="button" data-modal-mode="register">Create account</button>
      </div>
      <form class="auth-modal-form">
        <label for="modal-email">Email address</label>
        <input id="modal-email" name="email" type="email" autocomplete="username" required maxlength="254">
        <label for="modal-password">Password</label>
        <input id="modal-password" name="password" type="password" autocomplete="current-password" required minlength="12" maxlength="128">
        <button class="auth-modal-submit" type="submit">Continue securely</button>
      </form>
      <p class="auth-modal-status" role="status" aria-live="polite"></p>
      <button class="auth-modal-resend" type="button" hidden>Resend verification email</button>
    </section>`;
  document.body.appendChild(backdrop);

  const dialog = backdrop.querySelector('.auth-modal');
  const form = backdrop.querySelector('.auth-modal-form');
  const status = backdrop.querySelector('.auth-modal-status');
  const submit = backdrop.querySelector('.auth-modal-submit');
  const resend = backdrop.querySelector('.auth-modal-resend');
  const title = backdrop.querySelector('#auth-modal-title');
  const intro = backdrop.querySelector('.auth-modal-intro');
  let mode = 'login';
  let signedIn = false;

  const open = () => {
    backdrop.hidden = false;
    dialog.querySelector('input').focus();
  };

  const close = () => {
    if (!signedIn) return;
    backdrop.hidden = true;
  };

  const authLinks = document.querySelectorAll('a[href="auth.html"]');

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
      window.location.reload();
    }
  };

  const applyAuthLinkState = () => {
    authLinks.forEach((link) => {
      link.textContent = signedIn ? 'Sign out' : 'Sign in';
    });
  };

  authLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      if (signedIn) {
        logout();
      } else {
        open();
      }
    });
  });

  backdrop.querySelectorAll('[data-modal-mode]').forEach((tab) => {
    tab.addEventListener('click', () => {
      mode = tab.dataset.modalMode;
      backdrop.querySelectorAll('[data-modal-mode]').forEach((item) => item.classList.toggle('active', item === tab));
      const registering = mode === 'register';
      title.textContent = registering ? 'Create account' : 'Sign in';
      intro.textContent = registering
        ? 'Create a secure account. Administrator access is provisioned server-side.'
        : 'Enter your email and password to continue to the site.';
      submit.textContent = registering ? 'Create account securely' : 'Continue securely';
      form.password.autocomplete = registering ? 'new-password' : 'current-password';
      status.textContent = '';
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = '';
    submit.disabled = true;
    try {
      const email = String(form.email.value || '').trim();
      const password = String(form.password.value || '');
      if (!email || !password) {
        throw new Error('Enter your email and password to continue.');
      }
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Authentication failed.');
      status.textContent = result.message;
      status.style.color = '#c9a84c';
      if (mode === 'login') {
        signedIn = true;
        applyAuthLinkState();
        window.location.assign(result.role === 'admin' ? '/admin.html' : '/index.html');
        return;
      }
      form.reset();
      status.textContent = `${result.message} Sign in with those details to continue.`;
      mode = 'login';
      backdrop.querySelectorAll('[data-modal-mode]').forEach((item) => item.classList.toggle('active', item.dataset.modalMode === 'login'));
      title.textContent = 'Sign in';
      intro.textContent = 'Enter your email and password to continue to the site.';
      submit.textContent = 'Continue securely';
      form.password.autocomplete = 'current-password';
    } catch (error) {
      status.textContent = error.message;
      status.style.color = '#e98b8b';
      resend.hidden = mode !== 'login' || !error.message.toLowerCase().includes('verify');
    } finally { submit.disabled = false; }
  });

  resend.addEventListener('click', async () => {
    resend.disabled = true;
    try {
      const response = await fetch('/api/auth/resend-verification', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ email: form.email.value }) });
      const result = await response.json();
      status.textContent = result.message;
      status.style.color = '#c9a84c';
    } catch (error) {
      status.textContent = 'Unable to resend verification email.';
      status.style.color = '#e98b8b';
    } finally { resend.disabled = false; }
  });

  // Show the sign-in popup immediately when the page loads, so it always
  // appears in front rather than waiting on a network round-trip first.
  open();

  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then((response) => {
      if (response.ok) {
        signedIn = true;
        applyAuthLinkState();
        close();
      }
      // If not signed in, the modal is already open — nothing more to do.
    })
    .catch(() => {
      // Backend unreachable or offline: leave the modal open so the user
      // can still see the sign-in form rather than silently failing.
    });
})();