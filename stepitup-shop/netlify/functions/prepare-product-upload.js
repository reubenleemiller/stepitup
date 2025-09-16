const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const { verifyAdminToken } = require('./admin-auth');

function sanitizeFileName(name) {
  return String(name || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
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
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    // Auth
    const auth = event.headers['authorization'] || event.headers['Authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    const verified = verifyAdminToken(token);
    if (!verified.valid) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase not configured' }) };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const body = JSON.parse(event.body || '{}');
    const productData = body.productData || {};
    const files = body.files || {};

    if (!productData.name || !productData.category || !productData.price) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name, category, and price are required' }) };
    }

    // For create: files.product required; for update: productId provided, product file may be omitted
    const isUpdate = !!body.productId;
    if (!isUpdate && (!files.product || !files.product.filename || !files.product.contentType)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Product file metadata required' }) };
    }

    const productId = body.productId || uuidv4();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // Build storage paths
    const productPath = files.product ? `products/${productId}/${timestamp}-${sanitizeFileName(files.product.filename)}` : null;
    const previewPath = files.preview ? `previews/${productId}/${timestamp}-${sanitizeFileName(files.preview.filename)}` : null;
    const images = Array.isArray(files.resourceImages) ? files.resourceImages : [];
    const imagePaths = images.map((img) => `resource-images/${productId}/${timestamp}-${sanitizeFileName(img.filename)}`);

    // Create signed upload URLs
    const responses = {};

    if (productPath) {
      const { data: prodSigned, error: prodErr } = await supabase
        .storage
        .from('paid-resources')
        .createSignedUploadUrl(productPath);
      if (prodErr) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to prepare product upload', details: prodErr.message }) };
      }
      responses.product = { path: productPath, signedUrl: prodSigned?.signedUrl, token: prodSigned?.token };
    }

    if (previewPath) {
      const { data: prevSigned, error: prevErr } = await supabase
        .storage
        .from('resource-previews')
        .createSignedUploadUrl(previewPath);
      if (prevErr) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to prepare preview upload', details: prevErr.message }) };
      }
      responses.preview = { path: previewPath, signedUrl: prevSigned?.signedUrl, token: prevSigned?.token };
    }

    if (imagePaths.length) {
      responses.resourceImages = [];
      for (let i = 0; i < imagePaths.length; i++) {
        const path = imagePaths[i];
        const { data: imgSigned, error: imgErr } = await supabase
          .storage
          .from('resource-images')
          .createSignedUploadUrl(path);
        if (imgErr) {
          return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to prepare image upload', details: imgErr.message }) };
        }
        responses.resourceImages.push({ path, signedUrl: imgSigned?.signedUrl, token: imgSigned?.token });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        productId,
        upload: responses
      })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error', details: err.message }) };
  }
};
