(function() {
  // Helper to get URL param
  function getParam(key) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(key);
  }

  // Renders the confirmation using a session array
  function renderConfirmation(bookedSessions) {
    // Always remove container first
    document.querySelectorAll(".confirmation-container").forEach(e => e.remove());

    if (!bookedSessions || !bookedSessions.length) return;

    // Sort for display (ascending)
    bookedSessions.sort((a, b) => new Date(a.start_time || a.startTime) - new Date(b.start_time || b.startTime));

    const container = document.createElement("div");
    container.className = "confirmation-container";

    // Header
    const header = document.createElement("div");
    header.className = "confirmation-header";
    header.textContent = "Your Pending Bookings:";
    container.appendChild(header);

    // List all bookings with message AND horizontal bar between
    bookedSessions.forEach((session, idx) => {
      const attendeeName = session.attendeeName || getParam("attendeeName") || "";
      const rawTime = session.start_time || session.startTime;
      const date = new Date(rawTime);
      if (!rawTime || isNaN(date)) return;

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
      let sessions = bookedSessions.slice();
      if (sessions.length) {
        sessions.shift(); // Remove first
        sessionStorage.setItem("bookedSessions", JSON.stringify(sessions));
      }
      renderConfirmation(sessions);
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

  // Remove calendar if >=2 sessions booked
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

  // After a booking is made, get the last6 from backend and render it
  function fetchAndRenderBookings() {
    // Get user/email and event_id from URL params or global vars as needed
    const email = getParam("email");
    const eventId = getParam("eventTypeSlug") || getParam("event_id") || getParam("eventTypeId");

    if (!email || !eventId) {
      // fallback to sessionStorage as last resort
      let bookedSessions = [];
      try {
        bookedSessions = JSON.parse(sessionStorage.getItem("bookedSessions") || "[]");
      } catch (e) {}
      renderConfirmation(bookedSessions);
      removeEmbeddedCalendarIfNeeded();
      return;
    }

    fetch(`/api/booking/confirmation?email=${encodeURIComponent(email)}&event=${encodeURIComponent(eventId)}`)
      .then(res => res.json())
      .then(data => {
        if (data.last6 && Array.isArray(data.last6) && data.last6.length) {
          sessionStorage.setItem("bookedSessions", JSON.stringify(data.last6));
          renderConfirmation(data.last6);
        } else {
          // fallback to sessionStorage
          let bookedSessions = [];
          try {
            bookedSessions = JSON.parse(sessionStorage.getItem("bookedSessions") || "[]");
          } catch (e) {}
          renderConfirmation(bookedSessions);
        }
        removeEmbeddedCalendarIfNeeded();
      })
      .catch(() => {
        // fallback to sessionStorage
        let bookedSessions = [];
        try {
          bookedSessions = JSON.parse(sessionStorage.getItem("bookedSessions") || "[]");
        } catch (e) {}
        renderConfirmation(bookedSessions);
        removeEmbeddedCalendarIfNeeded();
      });
  }

  document.addEventListener('DOMContentLoaded', () => {
    fetchAndRenderBookings();
  });
})();