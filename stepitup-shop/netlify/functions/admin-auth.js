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

// Configurable session duration (in hours) - can be overridden per session from database
const DEFAULT_SESSION_DURATION_HOURS = parseInt(process.env.ADMIN_SESSION_DURATION_HOURS || '1', 10);

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

/**
 * Get session duration from database configuration or use default
 * This allows for dynamic session duration configuration
 * Priority: Environment variable > Database config > 1 hour default
 */
async function getSessionDurationHours(username) {
  // Always prioritize environment variable when explicitly set
  if (process.env.ADMIN_SESSION_DURATION_HOURS) {
    const envValue = parseInt(process.env.ADMIN_SESSION_DURATION_HOURS, 10);
    if (envValue > 0) {
      return envValue;
    }
  }

  if (!supabase) {
    return DEFAULT_SESSION_DURATION_HOURS;
  }

  try {
    // Try to get session configuration from a potential admin_config table
    // If it doesn't exist, we'll fall back to the default
    const { data: config } = await supabase
      .from('admin_config')
      .select('session_duration_hours')
      .eq('username', username)
      .maybeSingle();

    if (config && config.session_duration_hours && config.session_duration_hours > 0) {
      return parseInt(config.session_duration_hours, 10);
    }

    // Try to get global session configuration
    const { data: globalConfig } = await supabase
      .from('admin_config')
      .select('session_duration_hours')
      .eq('username', '*')
      .maybeSingle();

    if (globalConfig && globalConfig.session_duration_hours && globalConfig.session_duration_hours > 0) {
      return parseInt(globalConfig.session_duration_hours, 10);
    }
  } catch (error) {
    console.warn('Could not fetch session duration from database:', error);
  }

  return DEFAULT_SESSION_DURATION_HOURS;
}

exports.handler = async (event, context) => {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
    const { username, password, action } = JSON.parse(event.body || '{}');

    // Handle token validation
    if (action === 'validate') {
      const authHeader = event.headers['authorization'] || event.headers['Authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: 'No valid token provided' })
        };
      }

      const token = authHeader.substring(7);
      const verification = verifyAdminToken(token);
      
      if (!verification.valid) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: 'Invalid or expired token' })
        };
      }

      // Always check if session is still active in database for immediate expiry detection
      let sessionExpiresAt = verification.data.exp * 1000; // Default to JWT expiry
      if (supabase) {
        try {
          // First check if any sessions are expired and mark them inactive
          await supabase
            .from('admin_sessions')
            .update({ is_active: false })
            .eq('username', verification.data.username)
            .eq('is_active', true)
            .lt('expires_at', new Date().toISOString());

          // Now get the current active session
          const { data: session } = await supabase
            .from('admin_sessions')
            .select('is_active, expires_at')
            .eq('username', verification.data.username)
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          if (!session || new Date(session.expires_at) <= new Date()) {
            // Mark this session as inactive if it exists but is expired
            if (session) {
              await supabase
                .from('admin_sessions')
                .update({ is_active: false })
                .eq('username', verification.data.username)
                .eq('expires_at', session.expires_at);
            }
            return {
              statusCode: 401,
              headers,
              body: JSON.stringify({ error: 'Session expired' })
            };
          }

          // Use database session expiry time for more accurate session management
          sessionExpiresAt = new Date(session.expires_at).getTime();
        } catch (error) {
          console.warn('Could not validate session in database:', error);
          // Fail validation if database is configured but check fails
          return {
            statusCode: 401,
            headers,
            body: JSON.stringify({ error: 'Session validation failed' })
          };
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          valid: true, 
          username: verification.data.username,
          expiresAt: sessionExpiresAt
        })
      };
    }

    // Handle login
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

    // Generate JWT token with configurable expiry
    const sessionDurationHours = await getSessionDurationHours(username);
    const token = jwt.sign(
      {
        username: username,
        role: 'admin',
        iat: Math.floor(Date.now() / 1000)
      },
      JWT_SECRET,
      { expiresIn: sessionDurationHours * 60 * 60 } // seconds
    );

    // Create admin session record (if supabase configured)
    let sessionRecord = null;
    if (supabase) {
      const ip = extractClientIp(event.headers);
      const userAgent = (event.headers && (event.headers['user-agent'] || event.headers['User-Agent'])) || null;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + sessionDurationHours * 60 * 60 * 1000).toISOString();

      // First, check for existing active session for this user
      try {
        const { data: existingSession } = await supabase
          .from('admin_sessions')
          .select('id, session_token, created_at, expires_at, is_active, ip_address, user_agent')
          .eq('username', username)
          .eq('is_active', true)
          .gt('expires_at', now.toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (existingSession) {
          // Found an active session, check if it's from same IP/browser
          const sameIp = !ip || !existingSession.ip_address || existingSession.ip_address === ip;
          const sameUserAgent = !userAgent || !existingSession.user_agent || existingSession.user_agent === userAgent;
          
          if (sameIp && sameUserAgent) {
            // Same user, same browser/IP - extend the existing session instead of creating new one
            console.log(`Extending existing session ${existingSession.id} for user ${username}`);
            
            const { data: updatedSession, error: updateError } = await supabase
              .from('admin_sessions')
              .update({ expires_at: expiresAt })
              .eq('id', existingSession.id)
              .select('id, session_token, created_at, expires_at, is_active')
              .single();
            
            if (!updateError && updatedSession) {
              sessionRecord = updatedSession;
            } else {
              console.warn('Failed to extend existing session, will create new one:', updateError);
            }
          } else {
            console.log(`Different IP/browser detected for user ${username}, will create new session`);
          }
        }
      } catch (checkError) {
        console.warn('Failed to check for existing sessions:', checkError);
      }

      // If no suitable existing session was found or extended, create a new one
      if (!sessionRecord) {
        const sessionToken = uuidv4();
        
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
    }

    console.log(`Successful admin login for username: ${username} from IP: ${event.headers['x-forwarded-for'] || 'unknown'}`);

    // Always provide a valid sessionExpiresAt (ISO string)
    let sessionExpiresAt;
    if (sessionRecord && sessionRecord.expires_at) {
      sessionExpiresAt = sessionRecord.expires_at;
    } else {
      // Fallback: calculate from now + sessionDurationHours
      sessionExpiresAt = new Date(Date.now() + sessionDurationHours * 60 * 60 * 1000).toISOString();
    }
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        token: token,
        message: 'Authentication successful',
        sessionId: sessionRecord?.id || null,
        sessionToken: sessionRecord?.session_token || null,
        sessionExpiresAt
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
