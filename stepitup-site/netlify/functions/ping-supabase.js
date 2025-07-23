exports.handler = async function(event, context) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return {
      statusCode: 500,
      body: "Missing environment variables for Supabase URL or Service Role Key.",
    };
  }

  try {
    // Ping the reviews table; only fetch 1 row (doesn't matter if empty)
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/reviews?select=id&limit=1`, {
      headers: {
        apiKey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    if (!resp.ok) {
      throw new Error(`Supabase responded with status ${resp.status}`);
    }

    return {
      statusCode: 200,
      body: "Supabase pinged successfully using service role key.",
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: "Failed to ping Supabase: " + err.message,
    };
  }
};