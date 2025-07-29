import { createClient } from '@supabase/supabase-js';

// Environment variables (add these to your Netlify environment)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export default async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  // Require email and event query params
  const params = event.queryStringParameters || {};
  const email = (params.email || '').toLowerCase();
  const eventId = params.event || params.event_id || params.eventTypeId || '';

  if (!email || !eventId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing email or event id' }),
    };
  }

  try {
    // Fetch booking group for this user/event
    const { data: group, error } = await supabase
      .from('booking_groups')
      .select('session_start_times')
      .eq('email', email)
      .eq('event_id', eventId)
      .maybeSingle();

    if (error) throw error;

    let last6 = [];
    if (group && Array.isArray(group.session_start_times)) {
      last6 = group.session_start_times
        .slice() // shallow copy
        .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
        .slice(-6);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ last6 }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};