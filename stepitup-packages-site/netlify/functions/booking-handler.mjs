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

  const payload = data.payload || data;
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
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, duplicateBooking: true }) };
    }

    // Insert new booking id for tracking
    const { error: insertBookingError } = await supabase
      .from('booking_ids')
      .insert([{ booking_id: bookingId, email }]);

    if (insertBookingError) throw insertBookingError;

    // Maintain session times array with booking timestamps
    let sessionTimes = existingGroup?.session_start_times || [];

    // Add current booking time with timestamp
    if (!sessionTimes.some(st => st.start_time === startTime)) {
      sessionTimes.push({ start_time: startTime, booked_at: new Date().toISOString() });
    }

    // Sort sessionTimes by start_time ascending (for DB consistency)
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

    // Always use last 6 (sorted by start_time ASC) for confirmation email, matching frontend session/local storage display
    const last6 = sessionTimes.slice(-6);
    const isLatestOfLast6 = last6.length && last6[last6.length - 1].start_time === startTime;

    // Send email only ONCE per group of 6, only for the LAST (latest) booking in the group
    if (isLatestOfLast6 && bookingCount % 6 === 0) {
      const formattedTimes = last6
        .map(s => {
          const dt = DateTime.fromISO(s.start_time, { zone: "UTC" }).setZone(timezone);
          return `<li><b>${dt.toLocaleString(DateTime.DATETIME_MED)}</b></li>`;
        })
        .join("");
      const isFirstBatch = sessionTimes.length === 6;

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