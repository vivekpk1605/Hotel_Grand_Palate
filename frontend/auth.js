const form = document.querySelector('#auth-form');
const status = document.querySelector('#status');
const title = document.querySelector('#title');
const intro = document.querySelector('#intro');
const submit = form.querySelector('button[type="submit"]');
let mode = 'login';

document.querySelectorAll('[data-mode]').forEach((tab) => {
  tab.addEventListener('click', () => {
    mode = tab.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach((item) => item.classList.toggle('active', item === tab));
    const registering = mode === 'register';
    title.textContent = registering ? 'Create account' : 'Sign in';
    intro.textContent = registering ? 'Create a secure account. Administrator access is provisioned server-side.' : 'Access your account with your verified email address.';
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
    const body = Object.fromEntries(new FormData(form));
    const response = await fetch(`/api/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Authentication failed.');
    status.textContent = result.message;
    status.style.color = '#c9a84c';
    if (mode === 'login') {
      window.location.assign(result.role === 'admin' ? '/admin.html' : '/index.html');
    } else {
      form.reset();
    }
  } catch (error) {
    status.textContent = error.message;
    status.style.color = '#e98b8b';
  } finally {
    submit.disabled = false;
  }
});
