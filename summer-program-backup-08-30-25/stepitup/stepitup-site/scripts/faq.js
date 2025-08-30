document.querySelectorAll('.faq-question').forEach(btn => {
  btn.addEventListener('click', function() {
    const expanded = this.getAttribute('aria-expanded') === 'true';

    // Close all others
    document.querySelectorAll('.faq-question').forEach(q => {
      q.setAttribute('aria-expanded', 'false');
      const answer = q.nextElementSibling; // Get the answer related to the question
      if (answer) {
        answer.style.transition = 'none';  // Temporarily disable transitions when collapsing
        setTimeout(() => {
          answer.style.transition = ''; // Re-enable transitions for next open action
        }, 800); // Match transition time of 800ms for max-height
      }
    });

    // Only open if not already expanded
    if (!expanded) {
      this.setAttribute('aria-expanded', 'true');
      const answer = this.nextElementSibling;
      if (answer) {
        answer.style.transition = 'max-height 0.5s ease-in-out, opacity 0.3s ease-in-out'; // Apply longer transition
      }
    }
  });
});
