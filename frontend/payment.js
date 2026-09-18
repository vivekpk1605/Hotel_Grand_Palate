const params = new URLSearchParams(window.location.search);
const payButton = document.querySelector('#pay');
const status = document.querySelector('#status');
const orderId = params.get('order_id');
const keyId = params.get('key_id');
const amount = Number(params.get('amount'));
const currency = params.get('currency');

if (!orderId || !keyId || amount !== 200 || currency !== 'INR' || typeof Razorpay === 'undefined') {
  payButton.disabled = true;
  status.textContent = 'Payment could not be prepared. Return to the reservation form and try again.';
}

payButton.addEventListener('click', () => {
  payButton.disabled = true;
  status.textContent = '';
  const checkout = new Razorpay({
    key: keyId,
    amount,
    currency,
    name: 'The Grand Palate',
    description: 'Table reservation deposit',
    order_id: orderId,
    method: { upi: true, card: true, netbanking: true, wallet: true },
    config: {
      display: {
        blocks: {
          upi: { name: 'Pay using UPI', instruments: [{ method: 'upi' }] }
        },
        sequence: ['block.upi'],
        preferences: { show_default_blocks: true }
      }
    },
    handler: async (payment) => {
      try {
        const response = await fetch('/api/payments/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(payment) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Payment verification failed.');
        status.style.color = '#c9a84c';
        status.textContent = result.message;
        payButton.textContent = 'Reservation confirmed';
      } catch (error) {
        status.textContent = error.message;
        payButton.disabled = false;
      }
    },
    modal: { ondismiss: () => { payButton.disabled = false; status.textContent = 'Payment was cancelled.'; } }
  });
  checkout.open();
});