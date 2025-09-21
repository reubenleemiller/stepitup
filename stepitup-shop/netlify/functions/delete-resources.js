const { createClient } = require('@supabase/supabase-js');
const { verifyAdminToken } = require('./admin-auth');

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

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const auth = event.headers['authorization'] || event.headers['Authorization'] || '';
    const token = (auth.startsWith('Bearer ') ? auth.slice(7) : null) || null;
    if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    const verified = verifyAdminToken(token);
    if (!verified.valid) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase environment not configured' }) };
    }

    const { paths } = JSON.parse(event.body || '{}');
    if (!Array.isArray(paths) || paths.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'paths array required' }) };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const SAFE_PATHS = paths.filter(p => typeof p === 'string' && /^(Kinder|Grade [1-6])\/.+/.test(p));
    if (SAFE_PATHS.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No valid file paths to delete' }) };
    }

    const { data, error } = await supabase.storage.from('resources').remove(SAFE_PATHS);
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };

    // Get IP address for logging
    const clientIP = extractClientIp(event.headers);
    const userAgent = event.headers['user-agent'] || null;

    try {
      console.log(`Logging ${SAFE_PATHS.length} deleted resources to admin_activity_log`);
      
      // Log each deleted resource individually (resource_id is a generated uuid, file_path in details)
      const { v4: uuidv4 } = require('uuid');
      for (const path of SAFE_PATHS) {
        const logEntry = {
          username: verified.data?.username || 'admin',
          action: 'delete_resources',
          resource_type: 'storage',
          resource_id: uuidv4(),
          details: JSON.stringify({ 
            file_path: path,
            batch_count: SAFE_PATHS.length,
            timestamp: new Date().toISOString()
          }),
          ip_address: clientIP,
          user_agent: userAgent
        };
        console.log('Inserting delete activity log entry:', JSON.stringify(logEntry, null, 2));
        const { error: logError } = await supabase.from('admin_activity_log').insert(logEntry);
        if (logError) {
          console.error('Failed to insert delete activity log entry:', logError);
        } else {
          console.log('Successfully logged delete activity for:', path);
        }
      }
    } catch (logError) {
      console.error('Failed to log admin activity (outer catch):', logError);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, result: data }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
