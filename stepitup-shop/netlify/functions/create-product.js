const { createClient } = require('@supabase/supabase-js');
const multipart = require('lambda-multipart-parser');
const { v4: uuidv4 } = require('uuid');
const { verifyAdminToken } = require('./admin-auth');

/**
 * Create Product Function
 * Handles product creation with file uploads
 */

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const result = await multipart.parse(event);
    if (!result) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid form data' }) };

    const token = result.token;
    if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentication token required' }) };

    const tokenVerification = verifyAdminToken(token);
    if (!tokenVerification.valid) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired token' }) };

    const productData = JSON.parse(result.productData);
    if (!productData.name || !productData.category || !productData.price) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name, category, and price are required' }) };

    if (!result.files || !result.files.find(f => f.fieldname === 'productFile')) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Main product file is required' }) };

    const productFile = result.files.find(f => f.fieldname === 'productFile');
    const previewFile = result.files.find(f => f.fieldname === 'previewFile');
    const resourceImages = result.files.filter(f => f.fieldname === 'resourceImages');

    const productId = uuidv4();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // Upload main product file
    const productFileName = `products/${productId}/${timestamp}-${sanitizeFileName(productFile.filename)}`;
    const { error: productUploadError } = await supabase.storage
      .from('paid-resources')
      .upload(productFileName, productFile.content, {
        contentType: productFile.contentType,
        metadata: { productId, originalName: productFile.filename }
      });

    if (productUploadError) {
      console.error('Product file upload error:', productUploadError);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to upload product file' }) };
    }

    const { data: productUrlData } = supabase.storage
      .from('paid-resources')
      .getPublicUrl(productFileName);
    const productFileUrl = productUrlData.publicUrl;

    // Upload resource images and get the first image URL for the product
    let imageUrl = null;
    if (resourceImages && resourceImages.length > 0) {
      for (const image of resourceImages) {
        const imageFileName = `resource-images/${productId}/${timestamp}-${sanitizeFileName(image.filename)}`;
        const { error: imageUploadError } = await supabase.storage
          .from('resource-images')
          .upload(imageFileName, image.content, {
            contentType: image.contentType,
            metadata: { productId, originalName: image.filename }
          });

        if (!imageUploadError) {
          const { data: imageUrlData } = supabase.storage
            .from('resource-images')
            .getPublicUrl(imageFileName);
          
          // Use the first uploaded image as the main product image
          if (!imageUrl) {
            imageUrl = imageUrlData.publicUrl;
          }
        } else {
          console.warn('Resource image upload error:', imageUploadError);
        }
      }
    }

    // Insert product into products table
    const { data: insertedProduct, error: insertError } = await supabase
      .from('products')
      .insert({
        name: productData.name.trim(),
        description: productData.description?.trim() || null,
        price: Math.round(productData.price),
        category: productData.category,
        featured: productData.featured || false,
        resource_path: productFileName,
        image_url: imageUrl, // Link the first resource image to the product
        created_at: new Date().toISOString(),
        created_by: tokenVerification.data.username || 'admin',
        file_metadata: { originalName: productFile.filename, contentType: productFile.contentType }
      })
      .select()
      .single();

    if (insertError) {
      console.error('Database insert error:', insertError);
      await supabase.storage.from('paid-resources').remove([productFileName]);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create product record' }) };
    }

    // Upload preview and insert into paid_resource_previews table
    if (previewFile) {
      const previewFileName = `previews/${productId}/${timestamp}-${sanitizeFileName(previewFile.filename)}`;
      const { error: previewUploadError } = await supabase.storage
        .from('resource-previews')
        .upload(previewFileName, previewFile.content, {
          contentType: previewFile.contentType,
          metadata: { productId, originalName: previewFile.filename, type: 'preview' }
        });

      if (!previewUploadError) {
        const { data: previewUrlData } = supabase.storage
          .from('resource-previews')
          .getPublicUrl(previewFileName);

        const previewType = previewFile.contentType.startsWith('image/') ? 'image' : 'pdf';
        const fileSizeBytes = previewFile.content.length;

        const { error: previewInsertError } = await supabase
          .from('paid_resource_previews')
          .insert({
            product_id: insertedProduct.id,
            product_name: insertedProduct.name,
            preview_type: previewType,
            preview_url: previewUrlData.publicUrl,
            preview_thumbnail_url: null,
            file_size_bytes: fileSizeBytes,
            duration_seconds: null,
            page_count: null,
            description: `Preview for ${insertedProduct.name}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });

        if (previewInsertError) console.error('Preview record insert error:', previewInsertError);
      } else {
        console.error('Preview file upload error:', previewUploadError);
      }
    }

    console.log(`Product created successfully: ${insertedProduct.id} by admin: ${tokenVerification.data.username}`);

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Product created successfully',
        product: {
          id: insertedProduct.id,
          name: insertedProduct.name,
          price: insertedProduct.price,
          category: insertedProduct.category,
          featured: insertedProduct.featured
        }
      })
    };

  } catch (error) {
    console.error('Create product error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', details: process.env.NODE_ENV === 'development' ? error.message : undefined })
    };
  }
};

function sanitizeFileName(fileName) {
  return fileName.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase();
}

function getFileSizeMB(buffer) {
  return buffer.length / (1024 * 1024);
}