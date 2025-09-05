const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

/**
 * Admin Authentication Function
 * Handles admin login and token generation
 */

// Admin credentials (in production, store these securely in environment variables)
const ADMIN_CREDENTIALS = {
  username: process.env.ADMIN_USERNAME || 'admin',
  password: process.env.ADMIN_PASSWORD || 'StepItUp2024!'
};

const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-key-change-this-in-production';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;

function extractClientIp(headers = {}) {
  const h = Object.create(null);
  for (const k in headers) h[k.toLowerCase()] = headers[k];
  const candidates = [
    h['x-nf-client-connection-ip'],
    h['cf-connecting-ip'],
    h['x-real-ip'],
    h['client-ip'],
    h['x-forwarded-for']
  ].filter(Boolean);
  let raw = candidates.find(Boolean) || '';
  if (raw.includes(',')) raw = raw.split(',')[0].trim();
  // Normalize IPv4-mapped IPv6 like ::ffff:1.2.3.4
  if (/^::ffff:/i.test(raw) && /\d+\.\d+\.\d+\.\d+/.test(raw)) {
    raw = raw.match(/(\d+\.\d+\.\d+\.\d+)/)[1];
  }
  const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
  const ipv6 = /^[a-f0-9:]+$/i;
  return (ipv4.test(raw) || ipv6.test(raw)) ? raw : null;
}

exports.handler = async (event, context) => {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Handle preflight request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parse request body
    const { username, password } = JSON.parse(event.body || '{}');

    // Validate input
    if (!username || !password) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Username and password are required' })
      };
    }

    // Check credentials
    if (username !== ADMIN_CREDENTIALS.username || password !== ADMIN_CREDENTIALS.password) {
      // Log failed attempts (in production, implement rate limiting)
      console.log(`Failed login attempt for username: ${username} from IP: ${event.headers['x-forwarded-for'] || 'unknown'}`);

      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid credentials' })
      };
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        username: username,
        role: 'admin',
        iat: Math.floor(Date.now() / 1000)
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Create admin session record (if supabase configured)
    let sessionRecord = null;
    if (supabase) {
      const sessionToken = uuidv4();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const ip = extractClientIp(event.headers);
      const userAgent = (event.headers && (event.headers['user-agent'] || event.headers['User-Agent'])) || null;

      let data = null; let error = null;
      try {
        ({ data, error } = await supabase
          .from('admin_sessions')
          .insert([
            {
              session_token: sessionToken,
              username,
              ip_address: ip,
              user_agent: userAgent,
              expires_at: expiresAt,
              is_active: true
            }
          ])
          .select('id, session_token, created_at, expires_at, is_active')
          .single());
      } catch (e) {
        error = e;
      }

      if (error && error.code === '22P02') {
        // Retry without IP if inet parsing failed
        try {
          ({ data, error } = await supabase
            .from('admin_sessions')
            .insert([
              {
                session_token: sessionToken,
                username,
                ip_address: null,
                user_agent: userAgent,
                expires_at: expiresAt,
                is_active: true
              }
            ])
            .select('id, session_token, created_at, expires_at, is_active')
            .single());
        } catch (e2) {
          error = e2;
        }
      }

      if (error) {
        console.error('Failed creating admin session:', error);
      } else if (!data) {
        // Some Supabase/PostgREST setups may not return the inserted row reliably
        // Fetch the session we just created by token to ensure the client receives identifiers
        const { data: fetched } = await supabase
          .from('admin_sessions')
          .select('id, session_token, created_at, expires_at, is_active')
          .eq('session_token', sessionToken)
          .maybeSingle();
        sessionRecord = fetched || null;
      } else {
        sessionRecord = data;
      }
    }

    console.log(`Successful admin login for username: ${username} from IP: ${event.headers['x-forwarded-for'] || 'unknown'}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        token: token,
        message: 'Authentication successful',
        sessionId: sessionRecord?.id || null,
        sessionToken: sessionRecord?.session_token || null,
        sessionExpiresAt: sessionRecord?.expires_at || null
      })
    };

  } catch (error) {
    console.error('Admin auth error:', error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

/**
 * Utility function to verify JWT token
 * Can be imported by other functions
 */
function verifyAdminToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return { valid: true, data: decoded };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

module.exports.verifyAdminToken = verifyAdminToken;
