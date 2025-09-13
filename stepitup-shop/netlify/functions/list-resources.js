const { createClient } = require('@supabase/supabase-js');
const { verifyAdminToken } = require('./admin-auth');

const GRADES = ['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6'];

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const auth = event.headers['authorization'] || event.headers['Authorization'] || '';
    const token = (auth.startsWith('Bearer ') ? auth.slice(7) : null) || null;
    if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    const verified = verifyAdminToken(token);
    if (!verified.valid) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase environment not configured' }) };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const url = new URL(event.rawUrl || `https://x/x${event.path}?${event.rawQuery || ''}`);
    const grade = url.searchParams.get('grade') || 'All';

    async function listPrefix(prefix){
      const { data, error } = await supabase.storage.from('resources').list(prefix, { limit: 1000 });
      if (error) throw new Error(error.message);
      return (data||[])
        .filter(f => f && f.name && f.name !== '.emptyFolderPlaceholder')
        .map(f => ({
          name: f.name,
          path: `${prefix}${f.name}`,
          updated_at: f.updated_at || null,
          created_at: f.created_at || null,
          last_accessed_at: f.last_accessed_at || null,
          metadata: f.metadata || null
        }))
        // exclude folder entries defensively (folders appear when listing root)
        .filter(f => /\//.test(f.path) || (prefix && prefix.length>0));
    }

    let files = [];
    if (grade === 'All') {
      for (const g of GRADES) {
        const items = await listPrefix(`${g}/`);
        files = files.concat(items);
      }
    } else {
      files = await listPrefix(`${grade}/`);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, files }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
