const { createClient } = require('@supabase/supabase-js');
const { verifyAdminToken } = require('./admin-auth');

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
    const SAFE_PATHS = paths.filter(p => typeof p === 'string' && /^(Grade [1-6])\/.+/.test(p));
    if (SAFE_PATHS.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No valid file paths to delete' }) };
    }

    const { data, error } = await supabase.storage.from('resources').remove(SAFE_PATHS);
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };

    try {
      await supabase.rpc('log_admin_activity', {
        p_username: verified.data?.username || 'admin',
        p_action: 'delete_resources',
        p_resource_type: 'storage',
        p_resource_id: null,
        p_details: { count: paths.length, paths }
      });
    } catch (_) {}

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, result: data }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
