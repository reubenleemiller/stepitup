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

    // Track old files for cleanup
    const filesToDelete = [];

    // Handle product file replacement
    if (paths.product) {
      // Clean up old product file if it exists and is different
      if (current.resource_path && current.resource_path !== paths.product) {
        filesToDelete.push({
          bucket: 'paid-resources',
          path: current.resource_path
        });
      }
      updateData.resource_path = paths.product;
    }

    // Handle resource images replacement
    let imageUrl = current.image_url;
    if (Array.isArray(paths.resourceImages) && paths.resourceImages.length) {
      const first = paths.resourceImages[0];
      const { data: imgUrlData } = supabase.storage.from('resource-images').getPublicUrl(first);
      imageUrl = imgUrlData?.publicUrl || imageUrl;
      updateData.image_url = imageUrl;

      // Clean up old resource images folder for this product
      try {
        const { data: oldImageFiles } = await supabase.storage
          .from('resource-images')
          .list(`resource-images/${productId}`);

        if (oldImageFiles && oldImageFiles.length > 0) {
          oldImageFiles.forEach(file => {
            if (file.name && !file.name.includes('.folder')) {
              const oldPath = `resource-images/${productId}/${file.name}`;
              // Only delete if it's not one of the new files being uploaded
              if (!paths.resourceImages.includes(oldPath)) {
                filesToDelete.push({
                  bucket: 'resource-images',
                  path: oldPath
                });
              }
            }
          });
        }
      } catch (cleanupError) {
        console.warn('Error checking old resource images for cleanup:', cleanupError);
      }
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
      // Clean up old preview files for this product before adding new ones
      try {
        const { data: oldPreviewFiles } = await supabase.storage
          .from('resource-previews')
          .list(`previews/${productId}`);

        if (oldPreviewFiles && oldPreviewFiles.length > 0) {
          oldPreviewFiles.forEach(file => {
            if (file.name && !file.name.includes('.folder')) {
              const oldPath = `previews/${productId}/${file.name}`;
              // Only delete if it's not the new file being uploaded
              if (oldPath !== paths.preview) {
                filesToDelete.push({
                  bucket: 'resource-previews',
                  path: oldPath
                });
              }
            }
          });
        }
      } catch (cleanupError) {
        console.warn('Error checking old preview files for cleanup:', cleanupError);
      }

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

    // Clean up old files from storage
    if (filesToDelete.length > 0) {
      console.log(`Cleaning up ${filesToDelete.length} old files during product update`);
      
      // Group files by bucket for efficient deletion
      const bucketGroups = {};
      filesToDelete.forEach(file => {
        if (!bucketGroups[file.bucket]) {
          bucketGroups[file.bucket] = [];
        }
        bucketGroups[file.bucket].push(file.path);
      });

      // Delete files from each bucket
      for (const [bucket, paths] of Object.entries(bucketGroups)) {
        if (paths.length > 0) {
          try {
            const { error: deleteError } = await supabase.storage
              .from(bucket)
              .remove(paths);

            if (deleteError) {
              console.warn(`Error deleting old files from ${bucket}:`, deleteError);
            } else {
              console.log(`Successfully deleted ${paths.length} old files from ${bucket}`);
            }
          } catch (err) {
            console.warn(`Failed to delete from bucket ${bucket}:`, err.message);
          }
        }
      }
    }

    try {
      const ipRaw = event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || null;
      const clientIP = ipRaw ? String(ipRaw).split(',')[0].trim() : null;
      const userAgent = event.headers['user-agent'] || null;
      await supabase.from('admin_activity_log').insert({
        username: verified.data?.username || 'admin',
        action: 'update_product',
        resource_type: 'product',
        details: { 
          product_id: updated.id, 
          name: updated.name, 
          category: updated.category, 
          price: updated.price, 
          featured: updated.featured,
          files_cleaned_up: filesToDelete.map(f => f.path),
          cleanup_count: filesToDelete.length,
          timestamp: new Date().toISOString()
        },
        ip_address: clientIP,
        user_agent: userAgent
      });
    } catch (logError) {
      console.warn('Failed to log admin activity:', logError);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, product: { id: updated.id, name: updated.name, price: updated.price, category: updated.category, featured: updated.featured } }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error', details: err.message }) };
  }
};
