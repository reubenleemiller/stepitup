const { createClient } = require('@supabase/supabase-js');
const multipart = require('lambda-multipart-parser');
const { verifyAdminToken } = require('./admin-auth');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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
  if (/^::ffff:/i.test(raw) && /\d+\.\d+\.\d+\.\d+/.test(raw)) {
    raw = raw.match(/(\d+\.\d+\.\d+\.\d+)/)[1];
  }
  const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
  const ipv6 = /^[a-f0-9:]+$/i;
  return (ipv4.test(raw) || ipv6.test(raw)) ? raw : null;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: corsHeaders, body: '' };

  const authHeader = event.headers['authorization'] || event.headers['Authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  const token = authHeader.replace('Bearer ', '');
  const { valid, data } = verifyAdminToken(token);
  if (!valid) {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid or expired token' }) };
  }

  try {
    if (event.httpMethod === 'GET') {
      const url = new URL(event.rawUrl || `${process.env.URL || 'http://localhost'}${event.path.startsWith('/') ? '' : '/'}${event.path}`);
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
      const { data: reviews, error } = await supabase
        .from('reviews')
        .select('id, name, rating, review, image_url, created_at, featured, verified, email, phone')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) {
        console.error('Fetch reviews error:', error);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Failed to fetch reviews' }) };
      }
      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ reviews: reviews || [] }) };
    }

    if (event.httpMethod === 'PUT') {
      const body = JSON.parse(event.body || '{}');
      const { id, name, review, featured, rating } = body;
      if (!id) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'id is required' }) };

      const updates = {};
      if (typeof name === 'string') updates.name = name;
      if (typeof review === 'string') updates.review = review;
      if (typeof featured === 'boolean') updates.featured = featured;
      if (typeof rating === 'number') updates.rating = Math.max(1, Math.min(5, Math.round(rating)));

      if (Object.keys(updates).length === 0) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'No valid fields to update' }) };
      }

      const { data: updated, error } = await supabase
        .from('reviews')
        .update(updates)
        .eq('id', id)
        .select('id, name, review, featured')
        .single();

      if (error) {
        console.error('Update review error:', error);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Failed to update review' }) };
      }

      // Log activity with inet-safe IP
      try {
        const clientIP = extractClientIp(event.headers);
        const userAgent = (event.headers && (event.headers['user-agent'] || event.headers['User-Agent'])) || null;
        let logErr = null;
        try {
          await supabase.from('admin_activity_log').insert({
            username: data?.username || 'admin',
            action: 'update_review',
            resource_type: 'review',
            resource_id: id,
            details: updates,
            ip_address: clientIP,
            user_agent: userAgent
          });
        } catch (e) { logErr = e; }
        if (logErr && logErr.code === '22P02') {
          await supabase.from('admin_activity_log').insert({
            username: data?.username || 'admin',
            action: 'update_review',
            resource_type: 'review',
            resource_id: id,
            details: updates,
            ip_address: null,
            user_agent: userAgent
          });
        } else if (logErr) {
          console.warn('Failed to log update_review:', logErr);
        }
      } catch (logErrOuter) {
        console.warn('Failed to log update_review (outer):', logErrOuter);
      }

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, review: updated }) };
    }

    if (event.httpMethod === 'POST') {
      const form = await multipart.parse(event);
      const reviewId = form.fields?.id || form.id;
      const file = (form.files || [])[0];
      if (!reviewId || !file) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'id and image file are required' }) };
      }

      const cleanName = sanitizeFileName(file.filename);
      const path = `review-images/${reviewId}/${cleanName}`;

      // Delete existing files in folder
      try {
        const { data: existing } = await supabase.storage
          .from('review-images')
          .list(`review-images/${reviewId}`, { limit: 1000 });
        if (existing && existing.length > 0) {
          const toDelete = existing.filter(f => f.name && !f.name.includes('.folder')).map(f => `review-images/${reviewId}/${f.name}`);
          if (toDelete.length) {
            await supabase.storage.from('review-images').remove(toDelete);
          }
        }
      } catch (e) {
        console.warn('List/delete previous review images failed:', e);
      }

      const { error: uploadErr } = await supabase.storage
        .from('review-images')
        .upload(path, file.content, { contentType: file.contentType });
      if (uploadErr) {
        console.error('Upload review image error:', uploadErr);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Failed to upload image' }) };
      }

      const { data: urlData } = await supabase.storage
        .from('review-images')
        .getPublicUrl(path);

      const { error: updateErr } = await supabase
        .from('reviews')
        .update({ image_url: urlData.publicUrl })
        .eq('id', reviewId);
      if (updateErr) {
        console.error('Update review image_url error:', updateErr);
        return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Failed to update review image' }) };
      }

      // Log activity with inet-safe IP
      try {
        const clientIP = extractClientIp(event.headers);
        const userAgent = (event.headers && (event.headers['user-agent'] || event.headers['User-Agent'])) || null;
        let logErr = null;
        try {
          await supabase.from('admin_activity_log').insert({
            username: data?.username || 'admin',
            action: 'update_review_image',
            resource_type: 'review',
            resource_id: reviewId,
            details: { image_url: urlData.publicUrl },
            ip_address: clientIP,
            user_agent: userAgent
          });
        } catch (e) { logErr = e; }
        if (logErr && logErr.code === '22P02') {
          await supabase.from('admin_activity_log').insert({
            username: data?.username || 'admin',
            action: 'update_review_image',
            resource_type: 'review',
            resource_id: reviewId,
            details: { image_url: urlData.publicUrl },
            ip_address: null,
            user_agent: userAgent
          });
        } else if (logErr) {
          console.warn('Failed to log update_review_image:', logErr);
        }
      } catch (logErrOuter) {
        console.warn('Failed to log update_review_image (outer):', logErrOuter);
      }

      return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ success: true, image_url: urlData.publicUrl }) };
    }

    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (e) {
    console.error('admin-reviews fatal error:', e);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};

function sanitizeFileName(fileName) {
  return fileName.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase();
}
