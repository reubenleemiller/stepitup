async function subscribeNewsletter(email) {
  const res = await fetch('/.netlify/functions/newsletter-signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  if (!res.ok) throw new Error('Could not subscribe.');
}

async function enforceNewsletterGate(showResourcesCallback) {
  const container = document.getElementById('folder-tree');

  // Only prompt if not already subscribed in this browser
  const savedEmail = localStorage.getItem('newsletter_email');
  if (savedEmail) {
    showResourcesCallback();
    return;
  }

  container.innerHTML = `
    <div style="max-width:400px;margin:2em auto;">
      <label for="newsletter-email" style="font-weight:600;">Enter your email to access free resources:</label>
      <input id="newsletter-email" type="email" style="width:100%;padding:8px;margin:12px 0;border-radius:4px;border:1px solid #ccc;" required/>
      <button id="subscribe-btn"
        style="background:#2c77cc;color:#fff;border:none;padding:10px 20px;border-radius:4px;position:relative;min-width:110px;font-size:1.1em;display:inline-flex;align-items:center;gap:0.5em;height:44px;">
        <span class="btn-label" style="display:inline-block;">Subscribe</span>
        <span class="btn-spinner" style="display:none;width:16px;height:16px;border:2.5px solid #fff;border-top:2.5px solid #2c77cc;border-radius:50%;animation:btnspin 0.75s linear infinite;"></span>
      </button>
      <div id="newsletter-error" style="color:red;margin-top:10px;"></div>
    </div>
  `;
  document.getElementById('subscribe-btn').onclick = async function() {
    const btn = this;
    const btnLabel = btn.querySelector('.btn-label');
    const btnSpinner = btn.querySelector('.btn-spinner');
    const email = document.getElementById('newsletter-email').value.trim();
    const errorDiv = document.getElementById('newsletter-error');
    errorDiv.textContent = "";

    if (!email.match(/^[^@]+@[^@]+\.[^@]+$/)) {
      errorDiv.textContent = "Please enter a valid email.";
      return;
    }
    btn.disabled = true;
    btnLabel.style.visibility = 'hidden';
    btnSpinner.style.display = "inline-block";

    try {
      await subscribeNewsletter(email);
      // Store email in localStorage for future sessions
      localStorage.setItem('newsletter_email', email);
      showResourcesCallback();
    } catch (err) {
      errorDiv.textContent = err.message;
    }
    btn.disabled = false;
    btnLabel.style.visibility = '';
    btnSpinner.style.display = "none";
  };
}

// Spinner keyframes for inline button spinner
const style = document.createElement('style');
style.innerHTML = `@keyframes btnspin { to { transform: rotate(360deg); } }`;
document.head.appendChild(style);

document.addEventListener('DOMContentLoaded', () => {
  function startGate() {
    if (typeof window.loadRoot === "function") {
      enforceNewsletterGate(window.loadRoot);
    } else {
      setTimeout(startGate, 50);
    }
  }
  startGate();
});