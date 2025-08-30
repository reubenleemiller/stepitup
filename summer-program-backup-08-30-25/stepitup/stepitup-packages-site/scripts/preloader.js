  document.documentElement.classList.add('preloader-lock');

  const preloader = document.getElementById('site-preloader');
  const FADE_DURATION = 250;
  const MIN_DISPLAY = 500;
  let preloaderActive = false;
  let preloaderTriggered = false;
  let clickedNavigation = false;

  function showPreloader(noAnimation = false) {
    if (!preloader || preloaderActive || preloaderTriggered) return;

    preloaderTriggered = true;
    preloaderActive = true;

    document.body.classList.add('locked');
    document.body.classList.remove('unlocked');
    preloader.classList.remove('hidden', 'visible');

    if (noAnimation) {
      preloader.classList.add('visible');
    } else {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          preloader.classList.add('visible');
        });
      });
    }
  }

  function hidePreloader() {
    if (!preloader) return;

    preloader.classList.remove('visible');
    preloader.classList.add('hidden');

    setTimeout(() => {
      document.body.classList.remove('locked');
      document.body.classList.add('unlocked');
      document.documentElement.classList.remove('preloader-lock');
      preloaderActive = false;
      preloaderTriggered = false;
      clickedNavigation = false;
    }, FADE_DURATION);
  }

  // Trigger preloader only if not clicked already
  window.addEventListener('pageshow', (e) => {
    if (!clickedNavigation) {
      showPreloader(e.persisted);
      setTimeout(hidePreloader, MIN_DISPLAY);
    }
  });

  // Click handler for normal links
  document.addEventListener('click', (e) => {
    const el = e.target.closest('a, button');
    if (!el) return;

    if (
      el.hasAttribute('data-ignore-preloader') ||
      el.getAttribute('aria-expanded') !== null ||
      el.getAttribute('aria-haspopup') === 'true' ||
      el.classList.contains('dropdown-toggle') ||
      (el.classList.contains('nav-link') && el.getAttribute('role') === 'button')
    ) return;

    const isAnchor = el.tagName === 'A';
    const href = el.getAttribute('href');

    if (
      isAnchor &&
      href &&
      !href.startsWith('#') &&
      href !== window.location.href
    ) {
      clickedNavigation = true;
      // don't call showPreloader() here — let `pageshow` handle it
    }
  });

  // Admin reset form
  const resetForm = document.getElementById('reset-form');
  if (resetForm) {
    const responseEl = document.getElementById('response');
    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      showPreloader();

      const token = document.getElementById('token').value.trim();
      try {
        const res = await fetch("/.netlify/functions/reset-ticket", {
          method: "POST",
          headers: { "x-reset-token": token }
        });

        const data = await res.json();
        responseEl.textContent = data.success
          ? "✅ " + data.message
          : "❌ " + data.error;
      } catch {
        responseEl.textContent = "❌ An error occurred.";
      } finally {
        setTimeout(hidePreloader, FADE_DURATION);
      }
    });
  }

  // Failsafe
  setTimeout(() => {
    if (preloaderActive) hidePreloader();
  }, 5000);