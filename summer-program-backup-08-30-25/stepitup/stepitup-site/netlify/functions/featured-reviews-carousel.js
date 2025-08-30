const { createClient } = require("@supabase/supabase-js");

exports.handler = async function(event, context) {
  // Use environment variables for credentials
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Only allow GET requests
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      body: "Method Not Allowed"
    };
  }

  // Fetch featured reviews (optionally add .eq('verified', true) if you want only verified ones)
  const { data, error } = await supabase
    .from("reviews")
    .select("*")
    .eq("featured", true)
    .eq("verified", true)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify(data)
  };
};