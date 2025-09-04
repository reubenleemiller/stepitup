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
      const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || null;
      const userAgent = event.headers['user-agent'] || null;

      const { data, error } = await supabase
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
        .single();

      if (error) {
        console.error('Failed creating admin session:', error);
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
