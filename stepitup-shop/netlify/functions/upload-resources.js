const { createClient } = require('@supabase/supabase-js');
const multipart = require('lambda-multipart-parser');
const path = require('path');
const { verifyAdminToken } = require('./admin-auth');

const ALLOWED_GRADES = new Set([
  'Grade 1',
  'Grade 2',
  'Grade 3',
  'Grade 4',
  'Grade 5',
  'Grade 6'
]);

function sanitizeFileName(name) {
  const base = path.basename(name || 'file');
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Auth
    const auth = event.headers['authorization'] || event.headers['Authorization'] || '';
    const token = (auth.startsWith('Bearer ') ? auth.slice(7) : null) || null;
    if (!token) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
    const verified = verifyAdminToken(token);
    if (!verified.valid) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase environment not configured' }) };
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Parse multipart form (supports base64 body in Netlify)
    const parsed = await multipart.parse(event);
    if (!parsed) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid form data' }) };
    }

    const bucketRaw = String(parsed.bucket || parsed.targetBucket || 'resources').toLowerCase();
    const bucket = bucketRaw === 'kinder' ? 'kinder' : 'resources';

    const grade = String(parsed.grade || '').trim();
    if (!ALLOWED_GRADES.has(grade) && bucket === 'resources') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid grade' }) };
    }

    const files = (parsed.files || []).filter(Boolean);
    if (!files.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No files provided' }) };
    }

    // Validate bucket exists
    const { error: bucketErr } = await supabase.storage.from(bucket).list('', { limit: 1 });
    if (bucketErr && /not found|No such file or directory|resource was not found/i.test(bucketErr.message || '')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Supabase bucket "resources" not found' }) };
    }

    const uploads = [];
    for (const f of files) {
      try {
        const safeName = sanitizeFileName(f.filename || 'upload');
        const storagePath = `${grade}/${safeName}`;
        const { error: upErr } = await supabase.storage
          .from(bucket)
          .upload(storagePath, f.content, {
            contentType: f.contentType || 'application/octet-stream',
            upsert: false
          });
        if (upErr) {
          uploads.push({ file: safeName, path: storagePath, success: false, error: upErr.message });
        } else {
          uploads.push({ file: safeName, path: storagePath, success: true });
        }
      } catch (e) {
        uploads.push({ file: f?.filename || 'unknown', success: false, error: e.message });
      }
    }

    try {
      const clientIP = event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || null;
      const userAgent = event.headers['user-agent'] || null;
      await supabase.rpc('log_admin_activity', {
        p_username: verified.data?.username || 'admin',
        p_action: 'upload_resources',
        p_resource_type: 'storage',
        p_resource_id: null,
        p_details: { grade, count: uploads.length, uploads },
        p_ip_address: clientIP,
        p_user_agent: userAgent
      });
    } catch (_) {}

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, grade, uploads }) };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', message: error.message })
    };
  }
};
