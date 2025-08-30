(function() {
  function getParam(key) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(key);
  }

  function saveCurrentSession() {
    const attendeeName = getParam("attendeeName");
    const startTime = getParam("startTime");
    if (!attendeeName || !startTime) return;
    let bookedSessions = [];
    try {
      bookedSessions = JSON.parse(sessionStorage.getItem("bookedSessions") || "[]");
    } catch (e) {}
    if (!bookedSessions.some(s => s.attendeeName === attendeeName && s.startTime === startTime)) {
      bookedSessions.push({ attendeeName, startTime });
      if (bookedSessions.length > 6) bookedSessions = bookedSessions.slice(-6);
      sessionStorage.setItem("bookedSessions", JSON.stringify(bookedSessions));
    }
  }

  // MutationObserver to remove calendar any time it appears
  function observeAndRemoveCalendar() {
    let observer = new MutationObserver(() => {
      document.querySelectorAll("iframe, .cal-com-embed, .cal-embed, [data-cal-embed]").forEach(el => el.remove());
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Remove immediately in case already present
    document.querySelectorAll("iframe, .cal-com-embed, .cal-embed, [data-cal-embed]").forEach(el => el.remove());
  }

  function removeEmbeddedCalendarIfNeeded() {
    let bookedSessions = [];
    try {
      bookedSessions = JSON.parse(sessionStorage.getItem("bookedSessions") || "[]");
    } catch (e) {}
    if (bookedSessions.length >= 2) {
      observeAndRemoveCalendar();
    }
  }

  function renderConfirmation() {
    let bookedSessions = [];
    try {
      bookedSessions = JSON.parse(sessionStorage.getItem("bookedSessions") || "[]");
    } catch (e) {}
    // Always remove container first
    document.querySelectorAll(".confirmation-container").forEach(e => e.remove());

    if (!bookedSessions.length) return;

    bookedSessions.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

    const container = document.createElement("div");
    container.className = "confirmation-container";

    // Header
    const header = document.createElement("div");
    header.className = "confirmation-header";
    header.textContent = "Your Pending Bookings:";
    container.appendChild(header);

    // List all bookings with message AND horizontal bar between
    bookedSessions.forEach((session, idx) => {
      const { attendeeName, startTime } = session;
      const date = new Date(startTime);
      if (!attendeeName || !startTime || isNaN(date)) return;

      const formattedTime = new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: undefined,
        timeZoneName: "short"
      }).format(date);

      // Booking message
      const msg = document.createElement("div");
      msg.className = "confirmation-message";
      msg.innerHTML = `Booking for ${attendeeName} on <b>${formattedTime}</b>`;
      container.appendChild(msg);

      // Repeat message
      const repeatMsg = document.createElement("div");
      repeatMsg.className = "repeat-message";
      repeatMsg.textContent = "Repeated for the same time each week for 6 weeks.";
      container.appendChild(repeatMsg);

      // Horizontal bar between, but not after the last one
      if (idx < bookedSessions.length - 1) {
        const divider = document.createElement("hr");
        divider.className = "confirmation-divider";
        container.appendChild(divider);
      }
    });

    // Clear button
    const clearBtn = document.createElement("button");
    clearBtn.textContent = "Clear Booking";
    clearBtn.className = "confirmation-clear-btn";
    clearBtn.onclick = function() {
      let sessions = [];
      try {
        sessions = JSON.parse(sessionStorage.getItem("bookedSessions") || "[]");
      } catch (e) {}
      if (sessions.length) {
        sessions.shift(); // Remove the first session
        sessionStorage.setItem("bookedSessions", JSON.stringify(sessions));
      }
      renderConfirmation();
      removeEmbeddedCalendarIfNeeded();
    };
    container.appendChild(clearBtn);

    // Insert at the top of .content
    const contentContainer = document.querySelector(".content");
    if (contentContainer) {
      contentContainer.prepend(container);
    } else {
      document.body.prepend(container);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    saveCurrentSession();
    renderConfirmation();
    removeEmbeddedCalendarIfNeeded();
  });
})();