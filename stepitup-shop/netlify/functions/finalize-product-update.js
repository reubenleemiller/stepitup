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
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    const verified = verifyAdminToken(token);
    if (!verified.valid) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };

    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Supabase not configured' }) };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = JSON.parse(event.body || '{}');
    const productData = body.productData || {};
    const productId = productData.id || body.productId;
    const paths = body.paths || {};
    const fileMeta = body.fileMeta || {};

    if (!productId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Product ID is required' }) };
    if (!productData.name || !productData.category || typeof productData.price === 'undefined') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name, category, and price are required' }) };
    }

    const { data: current, error: fetchErr } = await supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .maybeSingle();
    if (fetchErr || !current) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Product not found' }) };
    }

    const updateData = {
      name: String(productData.name || '').trim(),
      description: productData.description ? String(productData.description).trim() : null,
      price: Math.round(Number(productData.price || 0)),
      category: productData.category,
      featured: Boolean(productData.featured)
    };

    if (paths.product) updateData.resource_path = paths.product;

    let imageUrl = current.image_url;
    if (Array.isArray(paths.resourceImages) && paths.resourceImages.length) {
      const first = paths.resourceImages[0];
      const { data: imgUrlData } = supabase.storage.from('resource-images').getPublicUrl(first);
      imageUrl = imgUrlData?.publicUrl || imageUrl;
      updateData.image_url = imageUrl;
    }

    if (paths.product || paths.resourceImages) {
      updateData.file_metadata = fileMeta.product || current.file_metadata;
    }

    const { data: updated, error: updateErr } = await supabase
      .from('products')
      .update(updateData)
      .eq('id', productId)
      .select()
      .single();

    if (updateErr) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to update product record', details: updateErr.message }) };
    }

    // Replace preview if new preview provided
    if (paths.preview) {
      await supabase.from('paid_resource_previews').delete().eq('product_id', productId);
      const { data: prevUrlData } = supabase.storage.from('resource-previews').getPublicUrl(paths.preview);
      const previewType = (fileMeta.preview?.contentType || '').startsWith('image/') ? 'image' : 'pdf';
      await supabase.from('paid_resource_previews').insert({
        product_id: productId,
        product_name: updated.name,
        preview_type: previewType,
        preview_url: prevUrlData?.publicUrl || null,
        preview_thumbnail_url: null,
        file_size_bytes: fileMeta.preview?.size || null,
        description: `Preview for ${updated.name}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
    }

    try {
      const ipRaw = event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || null;
      const clientIP = ipRaw ? String(ipRaw).split(',')[0].trim() : null;
      const userAgent = event.headers['user-agent'] || null;
      await supabase.from('admin_activity_log').insert({
        username: verified.data?.username || 'admin',
        action: 'update_product',
        resource_type: 'product',
        details: { product_id: updated.id, name: updated.name, category: updated.category, price: updated.price, featured: updated.featured },
        ip_address: clientIP,
        user_agent: userAgent
      });
    } catch (_) {}

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, product: { id: updated.id, name: updated.name, price: updated.price, category: updated.category, featured: updated.featured } }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error', details: err.message }) };
  }
};
