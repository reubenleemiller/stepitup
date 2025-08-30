// --- ADDED CODE: Animated Email/Phone Validation with embedded icons ---
// This file is intended to be loaded after reviews.js and only adds functionality, not removing any code.

document.addEventListener('preloader:done', function() {
  // --- Selectors ---
  const reviewForm = document.getElementById('review-form');
  if (!reviewForm) return; // Defensive

  // Utility to create icon span if not present
  function ensureIconWrapper(input, iconId) {
    let wrapper = input.parentNode;
    if (!wrapper.classList.contains('input-icon-wrapper')) {
      // Create wrapper
      wrapper = document.createElement('div');
      wrapper.className = 'input-icon-wrapper';
      wrapper.style.position = 'relative';
      wrapper.style.display = 'flex';
      wrapper.style.alignItems = 'center';
      input.parentNode.insertBefore(wrapper, input);
      wrapper.appendChild(input);
    }
    let icon = wrapper.querySelector(`#${iconId}`);
    if (!icon) {
      icon = document.createElement('span');
      icon.id = iconId;
      icon.style.position = 'absolute';
      icon.style.right = '16px';
      icon.style.top = '0';
      icon.style.bottom = '0';
      icon.style.margin = 'auto 0';
      icon.style.height = '1.5em';
      icon.style.display = 'flex';
      icon.style.alignItems = 'center';
      icon.style.fontSize = '1.4em';
      icon.style.transition = 'opacity 0.16s cubic-bezier(.5,0,.1,1), color 0.2s';
      icon.style.opacity = '0';
      icon.style.pointerEvents = 'none';
      icon.style.zIndex = '3';
      wrapper.appendChild(icon);
    }
    return icon;
  }

  // --- Validation and Animation Logic ---
  const emailInput = reviewForm.querySelector('input[name="email"]');
  const phoneInput = reviewForm.querySelector('input[name="phone"]');

  function showValid(input, icon) {
    input.style.borderColor = '#6CCE35';
    input.style.boxShadow = '0 0 2px 2px #eaffea';
    icon.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
    icon.style.color = '#6CCE35';
    icon.style.opacity = '1';
  }

  function showInvalid(input, icon) {
    input.style.borderColor = '#d32f2f';
    input.style.boxShadow = '0 0 2px 2px #ffcdd2';
    icon.innerHTML = '<i class="fa-solid fa-circle-xmark"></i>';
    icon.style.color = '#d32f2f';
    icon.style.opacity = '1';
  }

  function hideIcon(input, icon) {
    input.style.borderColor = '';
    input.style.boxShadow = '';
    icon.style.opacity = '0';
    icon.innerHTML = '';
  }

  // Real-time validation handlers
  function handleEmailInput() {
    const icon = ensureIconWrapper(emailInput, 'email-input-icon');
    const value = emailInput.value.trim();
    if (!value) {
      hideIcon(emailInput, icon);
      return;
    }
    // Use same validation as reviews.js
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      showValid(emailInput, icon);
    } else {
      showInvalid(emailInput, icon);
    }
  }

  // --- Format phone as (XXX) XXX-XXXX as user types ---
  function formatPhoneNumber(raw) {
    // Remove all non-digits
    let digits = raw.replace(/\D/g, '');
    // If country code, strip leading 1
    if (digits.length === 11 && digits.startsWith('1')) {
      digits = digits.substring(1);
    }
    // Only format if at least 1 digit
    if (digits.length === 0) return '';
    let formatted = '';
    if (digits.length <= 3) {
      formatted = '(' + digits;
    } else if (digits.length <= 6) {
      formatted = `(${digits.slice(0,3)}) ${digits.slice(3)}`;
    } else if (digits.length <= 10) {
      formatted = `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6,10)}`;
    } else {
      // For numbers > 10 digits, just append extra digits at end
      formatted = `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6,10)} ${digits.slice(10)}`;
    }
    return formatted;
  }

  // Prevent recursive event loop
  let formattingPhone = false;

  function handlePhoneInput() {
    const icon = ensureIconWrapper(phoneInput, 'phone-input-icon');
    let value = phoneInput.value;
    // --- Format phone as (XXX) XXX-XXXX as user types ---
    if (!formattingPhone) {
      formattingPhone = true;
      const start = phoneInput.selectionStart;
      const beforeFormat = phoneInput.value;
      const formatted = formatPhoneNumber(beforeFormat);
      phoneInput.value = formatted;
      // try to keep caret in place for user
      let diff = formatted.length - beforeFormat.length;
      let newPos = start + diff;
      if (newPos < 0) newPos = 0;
      phoneInput.setSelectionRange(newPos, newPos);
      formattingPhone = false;
      value = formatted;
    }

    // Improved: Only green if at least 10 digits (standard US/CA)
    let digits = value.replace(/\D/g, '');
    if (digits.length >= 10) {
      showValid(phoneInput, icon);
    } else if (value.trim() !== '') {
      showInvalid(phoneInput, icon);
    } else {
      hideIcon(phoneInput, icon);
    }
  }

  // Initial wrapper setup so icons always exist
  ensureIconWrapper(emailInput, 'email-input-icon');
  ensureIconWrapper(phoneInput, 'phone-input-icon');

  // Listen for input events for live validation
  emailInput.addEventListener('input', handleEmailInput);
  phoneInput.addEventListener('input', handlePhoneInput);

  // Also clear on blur if empty (for better UX)
  emailInput.addEventListener('blur', () => {
    if (!emailInput.value.trim()) {
      hideIcon(emailInput, document.getElementById('email-input-icon'));
    }
  });
  phoneInput.addEventListener('blur', () => {
    if (!phoneInput.value.trim()) {
      hideIcon(phoneInput, document.getElementById('phone-input-icon'));
    }
  });

  // On page load, check if already filled (browser autofill etc)
  handleEmailInput();
  handlePhoneInput();

  // --- Also, tie into setFieldError used by reviews.js, but only ADD to its effect ---
  const origSetFieldError = window.setFieldError;
  window.setFieldError = function(input, isError) {
    origSetFieldError && origSetFieldError(input, isError);
    if (!input) return;
    const icon = input === emailInput ? document.getElementById('email-input-icon')
                                     : input === phoneInput ? document.getElementById('phone-input-icon') : null;
    if (!icon) return;
    if (isError) {
      showInvalid(input, icon);
    } else if (input.value.trim()) {
      // Only show valid if non-empty and valid
      if (input === emailInput && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim())) {
        showValid(input, icon);
      } else if (input === phoneInput && input.value.replace(/\D/g, '').length >= 10) {
        showValid(input, icon);
      } else {
        hideIcon(input, icon);
      }
    } else {
      hideIcon(input, icon);
    }
  };
});