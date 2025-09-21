const { createClient } = require('@supabase/supabase-js');
const multipart = require('lambda-multipart-parser');
const path = require('path');
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

const ALLOWED_GRADES = new Set([
  'Kinder',
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

    const grade = String(parsed.grade || '').trim();
    if (!ALLOWED_GRADES.has(grade)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid grade' }) };
    }

    const files = (parsed.files || []).filter(Boolean);
    if (!files.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No files provided' }) };
    }

    // Validate bucket exists
    const { error: bucketErr } = await supabase.storage.from('resources').list('', { limit: 1 });
    if (bucketErr && /not found|No such file or directory|resource was not found/i.test(bucketErr.message || '')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Supabase bucket "resources" not found' }) };
    }

    const uploads = [];
    for (const f of files) {
      try {
        const safeName = sanitizeFileName(f.filename || 'upload');
        const storagePath = `${grade}/${safeName}`;
        const { error: upErr } = await supabase.storage
          .from('resources')
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
      const clientIP = extractClientIp(event.headers);
      const userAgent = event.headers['user-agent'] || null;
      
      console.log(`Logging ${uploads.filter(u => u.success).length} successful uploads to admin_activity_log`);
      
      // Log each successful upload individually (resource_id is a generated uuid, file_path in details)
      const { v4: uuidv4 } = require('uuid');
      for (const upload of uploads.filter(u => u.success)) {
        const logEntry = {
          username: verified.data?.username || 'admin',
          action: 'create_resources',
          resource_type: 'storage',
          resource_id: uuidv4(),
          details: JSON.stringify({ 
            file_name: upload.file,
            file_path: upload.path,
            grade: grade,
            batch_count: uploads.filter(u => u.success).length,
            timestamp: new Date().toISOString()
          }),
          ip_address: clientIP,
          user_agent: userAgent
        };
        console.log('Inserting activity log entry:', JSON.stringify(logEntry, null, 2));
        const { error: logError } = await supabase.from('admin_activity_log').insert(logEntry);
        if (logError) {
          console.error('Failed to insert activity log entry:', logError);
        } else {
          console.log('Successfully logged upload activity for:', upload.path);
        }
      }
    } catch (logError) {
      console.error('Failed to log admin activity (outer catch):', logError);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, grade, uploads }) };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', message: error.message })
    };
  }
};
