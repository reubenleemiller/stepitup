const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET_NAME = process.env.SUPABASE_BUCKET_NAME || "paid-resources";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing required Supabase environment variables');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async function(event, context) {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    const resource = event.queryStringParameters.resource;

    if (!resource) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Resource path is required" }),
      };
    }

    // Generate signed URL (valid for 1 hour)
    const { data, error } = await supabase
      .storage
      .from(BUCKET_NAME)
      .createSignedUrl(resource, 60 * 60); // 1 hour expiry

    if (error) {
      console.error('Supabase storage error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: "Failed to generate download link",
          details: error.message 
        }),
      };
    }

    if (!data || !data.signedUrl) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to generate signed URL" }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        signedUrl: data.signedUrl,
        expiresIn: 3600 // 1 hour in seconds
      }),
    };

  } catch (error) {
    console.error('Generate signed URL error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: "Internal server error",
        details: error.message 
      }),
    };
  }
};