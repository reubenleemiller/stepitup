const { createClient } = require('@supabase/supabase-js');
const { verifyAdminToken } = require('./admin-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing required Supabase environment variables');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
  'Cache-Control': 'no-store, max-age=0, must-revalidate'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    const authHeader = event.headers['authorization'] || event.headers['Authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const token = authHeader.replace('Bearer ', '');
    const { valid, error: authError } = verifyAdminToken(token);
    if (!valid) {
      return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid or expired token' }) };
    }

    const url = new URL(event.rawUrl || `${process.env.URL || 'https://admin.shop.stepituplearning.ca'}${event.path.startsWith('/') ? '' : '/'}${event.path}`);
    const type = url.searchParams.get('type') || 'sessions';
    const mode = url.searchParams.get('mode') || 'list'; // list | download
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '500', 10), 2000);

    if (type !== 'sessions' && type !== 'activity') {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid type parameter' }) };
    }

    if (event.httpMethod === 'DELETE' && type === 'sessions') {
      let keepToken = null;
      let keepId = null;
      try {
        if (event.body) {
          const body = JSON.parse(event.body);
          keepToken = body.keep_session_token || body.keep_token || null;
          keepId = body.keep_id || null;
        }
      } catch {}
      // Fallback to query params in case DELETE body is stripped by proxy
      try {
        keepToken = keepToken || url.searchParams.get('keep_session_token') || url.searchParams.get('keep_token');
        keepId = keepId || url.searchParams.get('keep_id');
      } catch {}

      if (!keepToken && !keepId) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'keep_session_token or keep_id is required' }) };
      }

      // Fetch all to compute deletions
      const { data: sessions, error: fetchErr } = await supabase
        .from('admin_sessions')
        .select('id, session_token');
      if (fetchErr) {
        console.error('Error fetching sessions for delete:', fetchErr);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Failed to fetch sessions' }) };
      }

      const toDeleteIds = (sessions || [])
        .filter(r => (keepToken ? r.session_token !== keepToken : true) && (keepId ? String(r.id) !== String(keepId) : true))
        .map(r => r.id);

      if (toDeleteIds.length === 0) {
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, deleted: 0 }) };
      }

      const { error: delErr } = await supabase
        .from('admin_sessions')
        .delete()
        .in('id', toDeleteIds);

      if (delErr) {
        console.error('Error deleting sessions:', delErr);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Failed to delete sessions' }) };
      }

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, deleted: toDeleteIds.length }) };
    }

    if (event.httpMethod === 'DELETE' && type === 'activity') {
      // Fetch IDs first to avoid unrestricted delete
      const { data: acts, error: actErr } = await supabase
        .from('admin_activity_log')
        .select('id');
      if (actErr) {
        console.error('Error fetching activity for delete:', actErr);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Failed to fetch activity' }) };
      }
      const ids = (acts || []).map(a => a.id);
      if (!ids.length) {
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, deleted: 0 }) };
      }
      const { error: delActErr } = await supabase
        .from('admin_activity_log')
        .delete()
        .in('id', ids);
      if (delActErr) {
        console.error('Error deleting activity:', delActErr);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Failed to delete activity' }) };
      }
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, deleted: ids.length }) };
    }

    if (type === 'sessions') {
      const { data, error } = await supabase
        .from('admin_sessions')
        .select('id, session_token, username, ip_address, user_agent, created_at, expires_at, is_active')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error fetching admin_sessions:', error);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Failed to fetch sessions' }) };
      }

      if (mode === 'download') {
        const csv = toCsv(data, [
          'id',
          'session_token',
          'username',
          'ip_address',
          'user_agent',
          'created_at',
          'expires_at',
          'is_active'
        ]);
        return {
          statusCode: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="admin-sessions.csv"`
          },
          body: csv
        };
      }

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ sessions: data }) };
    }

    if (type === 'activity') {
      const { data, error } = await supabase
        .from('admin_activity_log')
        .select('id, username, action, resource_type, resource_id, details, ip_address, user_agent, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error fetching admin_activity_log:', error);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Failed to fetch activity' }) };
      }

      // Coalesce resource_id for product actions to details.product_id (no schema changes)
      const normalized = (data || []).map(row => {
        if (!row.resource_id && row.resource_type === 'product' && row.details && (row.details.product_id || row.details.id)) {
          return { ...row, resource_id: String(row.details.product_id ?? row.details.id) };
        }
        return row;
      });

      if (mode === 'download') {
        const csv = toCsv(
          (normalized || []).map(row => ({
            ...row,
            details: row.details ? JSON.stringify(row.details) : ''
          })),
          [
            'id',
            'username',
            'action',
            'resource_type',
            'resource_id',
            'details',
            'ip_address',
            'user_agent',
            'created_at'
          ]
        );
        return {
          statusCode: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="admin-activity.csv"`
          },
          body: csv
        };
      }

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ activity: normalized }) };
    }

    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Unsupported request' }) };
  } catch (e) {
    console.error('admin-logs fatal error:', e);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};

function toCsv(rows, columns) {
  const header = columns.join(',');
  const escape = (val) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };
  const body = (rows || []).map(row => columns.map(col => escape(row[col])).join(',')).join('\n');
  return header + '\n' + body + '\n';
}
