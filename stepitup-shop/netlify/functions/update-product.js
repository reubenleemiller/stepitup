const { createClient } = require('@supabase/supabase-js');
const multipart = require('lambda-multipart-parser');
const { v4: uuidv4 } = require('uuid');
const { verifyAdminToken } = require('./admin-auth');

/**
 * Update Product Function
 * Handles product updates with optional file uploads
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
    const productId = productData.id;
    
    if (!productId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Product ID is required' }) };
    if (!productData.name || !productData.category || !productData.price) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name, category, and price are required' }) };

    // Get current product data
    const { data: currentProduct, error: fetchError } = await supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .single();

    if (fetchError) {
      console.error('Error fetching current product:', fetchError);
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Product not found' }) };
    }

    const productFile = result.files ? result.files.find(f => f.fieldname === 'productFile') : null;
    const previewFile = result.files ? result.files.find(f => f.fieldname === 'previewFile') : null;
    const resourceImages = result.files ? result.files.filter(f => f.fieldname === 'resourceImages') : [];

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    let newResourcePath = currentProduct.resource_path;
    let newImageUrl = currentProduct.image_url;

    // Upload new main product file if provided
    if (productFile) {
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

      // Delete old product file if it exists
      if (currentProduct.resource_path) {
        await supabase.storage.from('paid-resources').remove([currentProduct.resource_path]);
      }

      newResourcePath = productFileName;
    }

    // Upload new resource images if provided
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
          if (!newImageUrl || productData.replaceImages) {
            newImageUrl = imageUrlData.publicUrl;
          }
        } else {
          console.warn('Resource image upload error:', imageUploadError);
        }
      }
    }

    // Update product in database
    const { data: updatedProduct, error: updateError } = await supabase
      .from('products')
      .update({
        name: productData.name.trim(),
        description: productData.description?.trim() || null,
        price: Math.round(productData.price),
        category: productData.category,
        featured: productData.featured || false,
        resource_path: newResourcePath,
        image_url: newImageUrl,
        updated_at: new Date().toISOString(),
        file_metadata: productFile ? { 
          originalName: productFile.filename, 
          contentType: productFile.contentType,
          updatedAt: new Date().toISOString()
        } : currentProduct.file_metadata
      })
      .eq('id', productId)
      .select()
      .single();

    if (updateError) {
      console.error('Database update error:', updateError);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to update product record' }) };
    }

    // Update preview if provided
    if (previewFile) {
      // Delete existing previews for this product
      await supabase
        .from('paid_resource_previews')
        .delete()
        .eq('product_id', productId);

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
            product_id: updatedProduct.id,
            product_name: updatedProduct.name,
            preview_type: previewType,
            preview_url: previewUrlData.publicUrl,
            preview_thumbnail_url: null,
            file_size_bytes: fileSizeBytes,
            duration_seconds: null,
            page_count: null,
            description: `Preview for ${updatedProduct.name}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });

        if (previewInsertError) console.error('Preview record insert error:', previewInsertError);
      } else {
        console.error('Preview file upload error:', previewUploadError);
      }
    }

    console.log(`Product updated successfully: ${updatedProduct.id} by admin: ${tokenVerification.data.username}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Product updated successfully',
        product: {
          id: updatedProduct.id,
          name: updatedProduct.name,
          price: updatedProduct.price,
          category: updatedProduct.category,
          featured: updatedProduct.featured
        }
      })
    };

  } catch (error) {
    console.error('Update product error:', error);
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