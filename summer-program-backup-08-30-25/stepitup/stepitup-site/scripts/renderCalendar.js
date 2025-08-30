const availableTimes = document.getElementById('available-times');
const calendarEl = document.getElementById('calendar');
const loadingEl = document.getElementById('calendar-loading');
const refreshBtn = document.getElementById('calendar-refresh');
let fullCalendarInstance = null;

// Force spinner to always show on load, even if Safari does not fire events in order
function forceShowSpinnerOnLoad() {
  availableTimes.classList.add('loading');
  loadingEl.innerHTML = '<div class="spinner"></div><div style="margin-top:8px;font-size:12px;color:#2c77cc;font-weight:bold;">Availability updates every 5 minutes</div>';
  loadingEl.style.display = "flex";
}

function setLoading(isLoading) {
  if (isLoading) {
    availableTimes.classList.add('loading');
    loadingEl.innerHTML = '<div class="spinner"></div><div style="margin-top:8px;font-size:12px;color:#2c77cc;font-weight:bold;">Availability updates every 5 minutes</div>';
    loadingEl.style.display = "flex";
  } else {
    availableTimes.classList.remove('loading');
    loadingEl.style.display = "none";
  }
}

async function showCalendarWithSpinner(fetchPromise) {
  setLoading(true);
  const minDelay = new Promise(res => setTimeout(res, 600));
  const [data] = await Promise.all([fetchPromise, minDelay]);
  return data;
}

async function fetchAvailability() {
  const today = new Date();
  const startDate = today.toISOString().slice(0, 10);
  const endDate = new Date(today.getTime() + 18 * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10); // 18 weeks
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Edmonton';
  const params = new URLSearchParams({
    start: startDate,
    end: endDate,
    timeZone
  });
  const res = await fetch('/.netlify/functions/get-availability?' + params.toString(), {cache: "reload"});
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

function buildEventsFromSlots(data) {
  const slotDurationMinutes = 60;
  const events = [];
  if (!data || !data.slots) return events;

  // Flatten all slots into an array of Date objects for easier matching
  const allSlots = [];
  Object.values(data.slots).forEach(slotsArr => {
    for (const slot of slotsArr) {
      if (slot && slot.time) {
        allSlots.push(new Date(slot.time));
      }
    }
  });

  // For each slot, check if a slot with the same weekday/hour/minute exists for the next 6 weeks
  for (const slotDate of allSlots) {
    let availableConsecutively = true;
    for (let i = 1; i < 6; ++i) {
      const nextWeek = new Date(slotDate.getTime() + i * 7 * 24 * 60 * 60 * 1000);
      const match = allSlots.find(d =>
        d.getUTCFullYear() === nextWeek.getUTCFullYear() &&
        d.getUTCMonth() === nextWeek.getUTCMonth() &&
        d.getUTCDate() === nextWeek.getUTCDate() &&
        d.getUTCHours() === slotDate.getUTCHours() &&
        d.getUTCMinutes() === slotDate.getUTCMinutes()
      );
      if (!match) {
        availableConsecutively = false;
        break;
      }
    }
    if (availableConsecutively) {
      const start = slotDate.toISOString();
      const end = new Date(slotDate.getTime() + slotDurationMinutes * 60000).toISOString();
      if (!events.some(e => e.start === start)) {
        events.push({
          title: "Available",
          start,
          end,
          display: 'background',
          backgroundColor: "#5cb85c",
          extendedProps: {
            tooltip: `Available: ${new Date(start).toLocaleString()} - ${new Date(end).toLocaleString()} (meets 6-week requirement)`
          }
        });
      }
    }
  }
  return events;
}

async function renderCalendar() {
  try {
    setLoading(true);
    const data = await showCalendarWithSpinner(fetchAvailability());
    if (fullCalendarInstance) {
      fullCalendarInstance.destroy();
      calendarEl.innerHTML = '';
    }
    const events = buildEventsFromSlots(data);

    const initialDate = new Date();
    const maxDate = new Date(initialDate.getTime() + 12 * 7 * 24 * 60 * 60 * 1000); // 12 weeks from today

    fullCalendarInstance = new FullCalendar.Calendar(calendarEl, {
      initialView: 'timeGridWeek',
      initialDate: initialDate,
      allDaySlot: false,
      slotMinTime: "08:00:00",
      slotMaxTime: "20:00:00",
      events,
      selectable: false,
      editable: false,
      validRange: {
        start: initialDate.toISOString().slice(0,10),
        end: maxDate.toISOString().slice(0,10)
      },
      headerToolbar: {
        left: 'today prev,next',
        center: 'title',
        right: ''
      },
      buttonText: { today: 'today' },
      eventClick: () => {},
      eventDidMount: function(info) {
        if (info.event.display === "background" && info.event.extendedProps.tooltip) {
          info.el.setAttribute('title', info.event.extendedProps.tooltip);
        }
      }
    });
    fullCalendarInstance.render();
    setLoading(false);
  } catch (e) {
    loadingEl.innerHTML = "<div style='color:red; text-align:center;'>Failed to load availability.<br>" + (e.message || e) + "</div>";
    loadingEl.style.display = "flex";
    availableTimes.classList.add('loading');
  }
}

// Ensure no debug or error output tries to directly print slot objects or arrays
// (No code should set availableTimes.innerHTML or similar to raw data!)

if (refreshBtn) {
  refreshBtn.addEventListener('click', () => {
    setLoading(true);
    renderCalendar();
  });
}

forceShowSpinnerOnLoad();

// --- WAIT FOR PRELOADER TO FINISH BEFORE STARTING CALENDAR ---

function startCalendarAfterPreloader() {
  setLoading(true);
  renderCalendar();
}

// If preloader is already gone, run right away. Otherwise, wait for the event.
if (
  !document.documentElement.classList.contains('preloader-lock') &&
  !document.body.classList.contains('locked')
) {
  startCalendarAfterPreloader();
} else {
  document.addEventListener('preloader:done', startCalendarAfterPreloader, { once: true });
}

// Fallback for page restore from bfcache
window.addEventListener('pageshow', function(event) {
  if (!fullCalendarInstance) {
    setLoading(true);
    renderCalendar();
  }
});