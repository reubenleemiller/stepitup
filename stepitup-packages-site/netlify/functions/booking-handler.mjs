import fetch from 'node-fetch';
import supabase from './_supabase.js';
import { welcomeEmail, confirmationEmail } from './emailTemplates.js';
import { DateTime } from 'luxon';

const logoUrl = "https://www.stepituplearning.ca/assets/logo.png";

export async function handler(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch (err) {
    return { statusCode: 400, headers, body: 'Invalid JSON' };
  }

  // Cal.com payload may be wrapped in payload key or sent raw
  const payload = data.payload || data;

  // Extract relevant fields, handling possible naming differences
  const bookingId = payload.bookingId || payload.id;
  const eventId = payload.eventTypeId || payload.event_type_id;
  const startTime = payload.startTime || payload.start_time;
  const attendee = payload.attendees?.[0];

  if (!bookingId || !eventId || !startTime || !attendee || !attendee.email) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ success: false, error: "Missing required booking info" }),
    };
  }

  const email = attendee.email.toLowerCase();
  const name = attendee.name || "there";
  const timezone = attendee.timeZone || attendee.timezone || "UTC";

  try {
    // Fetch existing booking group for user + event
    const { data: existingGroup, error: groupError } = await supabase
      .from('booking_groups')
      .select('*')
      .eq('email', email)
      .eq('event_id', eventId)
      .maybeSingle();

    if (groupError) throw groupError;

    // Check if booking id already processed (avoid duplicate emails)
    const { data: existingBooking, error: bookingError } = await supabase
      .from('booking_ids')
      .select('id')
      .eq('booking_id', bookingId)
      .maybeSingle();

    if (bookingError) throw bookingError;

    if (existingBooking) {
      // Duplicate booking, no email sent
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, duplicateBooking: true }) };
    }

    // Insert new booking id for tracking
    const { error: insertBookingError } = await supabase
      .from('booking_ids')
      .insert([{ booking_id: bookingId, email }]);

    if (insertBookingError) throw insertBookingError;

    // Maintain session times array with booking timestamps
    // If existing group: update array, else create new group
    let sessionTimes = existingGroup?.session_start_times || [];

    // Add current booking time with timestamp
    if (!sessionTimes.some(st => st.start_time === startTime)) {
      sessionTimes.push({ start_time: startTime, booked_at: new Date().toISOString() });
    }

    // Sort sessionTimes by start_time ascending (optional, for DB consistency)
    sessionTimes.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

    const bookingCount = sessionTimes.length;

    if (existingGroup) {
      const { error: upsertError } = await supabase
        .from('booking_groups')
        .update({ session_start_times: sessionTimes, booking_count: bookingCount })
        .eq('id', existingGroup.id);

      if (upsertError) throw upsertError;
    } else {
      const { error: insertGroupError } = await supabase
        .from('booking_groups')
        .insert([{ email, event_id: eventId, session_start_times: sessionTimes, booking_count: bookingCount, sent_email: false }]);

      if (insertGroupError) throw insertGroupError;
    }

    // Send email only every 6 bookings
    if (bookingCount % 6 === 0) {
      // Take last 6 sessions sorted by booked_at descending (most recent first)
      const last6Sessions = [...sessionTimes]
        .sort((a, b) => new Date(b.booked_at) - new Date(a.booked_at))
        .slice(0, 6);

      // Then reorder those 6 by start_time ascending (earliest time at top)
      const last6SortedByStartTime = last6Sessions.sort(
        (a, b) => new Date(a.start_time) - new Date(b.start_time)
      );

      // Format times for email in user's timezone
      const formattedTimes = last6SortedByStartTime
        .map(s => {
          const dt = DateTime.fromISO(s.start_time, { zone: "UTC" }).setZone(timezone);
          return `<li><b>${dt.toLocaleString(DateTime.DATETIME_MED)}</b></li>`;
        })
        .join("");

      const isFirstBatch = bookingCount === 6;

      const emailHtml = isFirstBatch
        ? welcomeEmail(name, formattedTimes, logoUrl)
        : confirmationEmail(name, formattedTimes, logoUrl);

      const sendResult = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: "Step it Up Learning <info@stepituplearning.ca>",
          to: email,
          subject: "Your Step it Up Learning Sessions",
          html: emailHtml,
        }),
      });

      if (!sendResult.ok) {
        const errBody = await sendResult.text();
        throw new Error(`Resend API error: ${sendResult.status} - ${errBody}`);
      }

      // Mark sent_email flag true after first welcome batch
      if (isFirstBatch) {
        const { error: markSentError } = await supabase
          .from('booking_groups')
          .update({ sent_email: true })
          .eq('email', email)
          .eq('event_id', eventId);

        if (markSentError) throw markSentError;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, bookingCount }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
}
