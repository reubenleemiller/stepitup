const { createClient } = require('@supabase/supabase-js');
const { verifyAdminToken } = require('./admin-auth');

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
    const productId = body.productId;
    const paths = body.paths || {};
    const fileMeta = body.fileMeta || {};

    if (!productId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'productId required' }) };
    if (!paths.product) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Product file path required' }) };

    // Public URLs
    const { data: productUrlData } = supabase.storage.from('paid-resources').getPublicUrl(paths.product);
    const productFileUrl = productUrlData?.publicUrl || null;

    let imageUrl = null;
    if (Array.isArray(paths.resourceImages) && paths.resourceImages.length) {
      const first = paths.resourceImages[0];
      const { data: imgUrlData } = supabase.storage.from('resource-images').getPublicUrl(first);
      imageUrl = imgUrlData?.publicUrl || null;
    }

    // Insert product
    const { data: inserted, error: insertErr } = await supabase
      .from('products')
      .insert({
        name: String(productData.name || '').trim(),
        description: productData.description ? String(productData.description).trim() : null,
        price: Math.round(Number(productData.price || 0)),
        category: productData.category,
        featured: Boolean(productData.featured),
        resource_path: paths.product,
        image_url: imageUrl,
        created_at: new Date().toISOString(),
        created_by: verified.data?.username || 'admin',
        file_metadata: fileMeta.product || null
      })
      .select()
      .single();

    if (insertErr) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create product record', details: insertErr.message }) };
    }

    // Preview record
    if (paths.preview) {
      const { data: prevUrlData } = supabase.storage.from('resource-previews').getPublicUrl(paths.preview);
      const previewType = (fileMeta.preview?.contentType || '').startsWith('image/') ? 'image' : 'pdf';
      const { error: prevInsertErr } = await supabase
        .from('paid_resource_previews')
        .insert({
          product_id: inserted.id,
          product_name: inserted.name,
          preview_type: previewType,
          preview_url: prevUrlData?.publicUrl || null,
          preview_thumbnail_url: null,
          file_size_bytes: fileMeta.preview?.size || null,
          duration_seconds: null,
          page_count: null,
          description: `Preview for ${inserted.name}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      if (prevInsertErr) {
        // Non-fatal; log to table if available
        console.error('Preview record insert error:', prevInsertErr);
      }
    }

    // Log admin activity
    try {
      const ipRaw = event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || null;
      const clientIP = ipRaw ? String(ipRaw).split(',')[0].trim() : null;
      const userAgent = event.headers['user-agent'] || null;
      await supabase.from('admin_activity_log').insert({
        username: verified.data?.username || 'admin',
        action: 'create_product',
        resource_type: 'product',
        details: {
          product_id: inserted.id,
          name: inserted.name,
          category: inserted.category,
          price: inserted.price,
          featured: inserted.featured
        },
        ip_address: clientIP,
        user_agent: userAgent
      });
    } catch (e) {
      console.warn('Failed to log create_product:', e);
    }

    return { statusCode: 201, headers, body: JSON.stringify({ success: true, product: { id: inserted.id, name: inserted.name, price: inserted.price, category: inserted.category, featured: inserted.featured } }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error', details: err.message }) };
  }
};
