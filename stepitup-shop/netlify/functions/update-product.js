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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    console.log('=== UPDATE PRODUCT FUNCTION START ===');
    console.log('Event method:', event.httpMethod);
    console.log('Event headers:', event.headers);

    const result = await multipart.parse(event);
    console.log('Multipart parse result keys:', result ? Object.keys(result) : 'null');
    if (!result) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid form data' }) };

    const authHeader = event.headers['authorization'] || event.headers['Authorization'];
    const headerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : null;
    const token = headerToken || result.token;
    console.log('Token present:', !!token);
    if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Authentication token required' }) };

    console.log('Verifying token...');
    const tokenVerification = verifyAdminToken(token);
    console.log('Token verification result:', tokenVerification.valid);
    if (!tokenVerification.valid) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired token' }) };

    console.log('Parsing product data...');
    const productData = JSON.parse(result.productData);
    console.log('Product data:', productData);
    const productId = productData.id;
    console.log('Product ID:', productId);
    
    if (!productId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Product ID is required' }) };
    if (!productData.name || !productData.category || !productData.price) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name, category, and price are required' }) };

    // Get current product data
    console.log('Fetching current product data for ID:', productId);
    const { data: currentProduct, error: fetchError } = await supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .single();

    console.log('Current product fetch result:', { data: !!currentProduct, error: fetchError });

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
      console.log(`Updating main product file for product ${productId}`);

      // Delete old product file first
      if (currentProduct.resource_path) {
        console.log(`Deleting old product file: ${currentProduct.resource_path}`);
        await supabase.storage.from('paid-resources').remove([currentProduct.resource_path]);
        
        // Log storage deletion
        try {
          const clientIP = event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || null;
          const userAgent = event.headers['user-agent'] || null;
          await supabase.from('admin_activity_log').insert({
            username: tokenVerification.data.username || 'admin',
            action: 'delete_storage_file',
            resource_type: 'storage',
            resource_id: currentProduct.resource_path,
            details: {
              file_path: currentProduct.resource_path,
              bucket: 'paid-resources',
              context: 'product_update',
              product_id: productId
            },
            ip_address: clientIP,
            user_agent: userAgent
          });
        } catch (logError) {
          console.warn('Failed to log storage deletion:', logError);
        }
      }

      // Also delete any files in the products folder for this product
      try {
        const { data: existingFiles } = await supabase.storage
          .from('paid-resources')
          .list(`products/${productId}`);

        if (existingFiles && existingFiles.length > 0) {
          const filePaths = existingFiles.map(file => `products/${productId}/${file.name}`);
          await supabase.storage.from('paid-resources').remove(filePaths);
          
          // Log bulk storage deletion
          try {
            const clientIP = event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || null;
            const userAgent = event.headers['user-agent'] || null;
            await supabase.from('admin_activity_log').insert({
              username: tokenVerification.data.username || 'admin',
              action: 'delete_storage_folder',
              resource_type: 'storage',
              resource_id: `products/${productId}`,
              details: {
                folder_path: `products/${productId}`,
                files_deleted: filePaths,
                file_count: filePaths.length,
                bucket: 'paid-resources',
                context: 'product_update',
                product_id: productId
              },
              ip_address: clientIP,
              user_agent: userAgent
            });
          } catch (logError) {
            console.warn('Failed to log storage folder deletion:', logError);
          }
        }
      } catch (cleanupError) {
        console.warn('Error cleaning up old product files:', cleanupError);
      }

      const cleanFileName = sanitizeFileName(productFile.filename);
      const productFileName = `products/${productId}/${cleanFileName}`;

      console.log(`📤 Uploading main product file: ${productFileName}`);

      const { error: productUploadError } = await supabase.storage
        .from('paid-resources')
        .upload(productFileName, productFile.content, {
          contentType: productFile.contentType,
          metadata: {
            productId: productId.toString(),
            originalName: productFile.filename,
            uploadedAt: new Date().toISOString()
          }
        });

      if (productUploadError) {
        console.error('Product file upload error:', productUploadError);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to upload product file' }) };
      }

      newResourcePath = productFileName;
      console.log(`✅ Product file updated: ${newResourcePath}`);
    }

    // Upload new resource images if provided
    if (resourceImages && resourceImages.length > 0) {
      console.log(`Uploading ${resourceImages.length} new resource images for product ${productId}`);

      // STEP 1: Delete the ENTIRE product folder from resource-images bucket
      try {
        console.log(`Deleting entire resource-images folder for product ${productId}...`);

        // Try to delete the entire folder by removing all files in it
        const { data: existingFiles } = await supabase.storage
          .from('resource-images')
          .list(`resource-images/${productId}`, { limit: 1000 });

        if (existingFiles && existingFiles.length > 0) {
          console.log(`Found ${existingFiles.length} files in product folder, deleting all...`);
          const filePaths = existingFiles.map(file => `resource-images/${productId}/${file.name}`);

          const { error: deleteError } = await supabase.storage
            .from('resource-images')
            .remove(filePaths);

          if (deleteError) {
            console.warn('Error deleting folder contents:', deleteError);
          } else {
            console.log('✅ Successfully deleted entire product folder');
            
            // Log resource images deletion
            try {
              const clientIP = event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || null;
              const userAgent = event.headers['user-agent'] || null;
              await supabase.from('admin_activity_log').insert({
                username: tokenVerification.data.username || 'admin',
                action: 'delete_storage_folder',
                resource_type: 'storage',
                resource_id: `resource-images/${productId}`,
                details: {
                  folder_path: `resource-images/${productId}`,
                  files_deleted: filePaths,
                  file_count: filePaths.length,
                  bucket: 'resource-images',
                  context: 'product_update',
                  product_id: productId
                },
                ip_address: clientIP,
                user_agent: userAgent
              });
            } catch (logError) {
              console.warn('Failed to log resource images deletion:', logError);
            }
          }
        } else {
          console.log('No existing files found in product folder');
        }

        // Also check and clean any files at root level that might belong to this product
        const { data: rootFiles } = await supabase.storage
          .from('resource-images')
          .list('', { limit: 1000 });

        if (rootFiles) {
          const productFiles = rootFiles.filter(file =>
            file.name && file.name.includes(productId.toString())
          );

          if (productFiles.length > 0) {
            console.log(`Found ${productFiles.length} orphaned files at root level, cleaning...`);
            const rootFilePaths = productFiles.map(file => file.name);
            await supabase.storage.from('resource-images').remove(rootFilePaths);
          }
        }

      } catch (deleteError) {
        console.warn('Error in folder deletion:', deleteError);
      }

      // STEP 2: Upload new images to clean product folder
      console.log(`Creating fresh product folder and uploading ${resourceImages.length} new images...`);

      for (const image of resourceImages) {
        const cleanFileName = sanitizeFileName(image.filename);
        const imageFileName = `resource-images/${productId}/${cleanFileName}`;

        console.log(`📤 Uploading: ${imageFileName}`);

        const { error: imageUploadError } = await supabase.storage
          .from('resource-images')
          .upload(imageFileName, image.content, {
            contentType: image.contentType,
            metadata: {
              productId: productId.toString(),
              originalName: image.filename,
              uploadedAt: new Date().toISOString()
            }
          });

        if (!imageUploadError) {
          const { data: imageUrlData } = supabase.storage
            .from('resource-images')
            .getPublicUrl(imageFileName);

          console.log(`📸 Generated image URL: ${imageUrlData.publicUrl}`);

          // Use the first uploaded image as the main product image (reset newImageUrl for new uploads)
          if (newImageUrl === currentProduct.image_url) {
            // This is the first new image being uploaded, use it as main image
            newImageUrl = imageUrlData.publicUrl;
            console.log(`✅ Set new main product image (first upload): ${newImageUrl}`);
          } else {
            console.log(`ℹ️ Additional image uploaded: ${imageUrlData.publicUrl}`);
          }
        } else {
          console.error('❌ Resource image upload error:', imageUploadError);
        }
      }

      console.log(`✅ Completed resource images update for product ${productId}`);
    }

    // Update product in database
    console.log('Preparing database update...');
    const updateData = {
      name: productData.name.trim(),
      description: productData.description?.trim() || null,
      price: Math.round(productData.price),
      category: productData.category,
      featured: Boolean(productData.featured),
      resource_path: newResourcePath,
      image_url: newImageUrl,
      file_metadata: productFile ? {
        originalName: productFile.filename,
        contentType: productFile.contentType,
        updatedAt: new Date().toISOString()
      } : currentProduct.file_metadata
    };

    console.log('📊 Update data being sent to database:', updateData);
    console.log('🔍 Key values:');
    console.log('  - image_url:', updateData.image_url);
    console.log('  - resource_path:', updateData.resource_path);
    console.log('  - featured:', updateData.featured);
    console.log('🎯 Executing database update for product ID:', productId);

    const { data: updatedProduct, error: updateError } = await supabase
      .from('products')
      .update(updateData)
      .eq('id', productId)
      .select()
      .single();

    console.log('📈 Database update result:', { data: !!updatedProduct, error: updateError });

    if (updatedProduct) {
      console.log('✅ Updated product in database:');
      console.log('  - ID:', updatedProduct.id);
      console.log('  - Name:', updatedProduct.name);
      console.log('  - Image URL:', updatedProduct.image_url);
      console.log('  - Featured:', updatedProduct.featured);
    }

    if (updateError) {
      console.error('Database update error:', updateError);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to update product record' }) };
    }

    // Update preview if provided
    if (previewFile) {
      console.log(`Updating preview file for product ${productId}`);

      // STEP 1: Delete existing preview database records
      const { error: dbDeleteError } = await supabase
        .from('paid_resource_previews')
        .delete()
        .eq('product_id', productId);

      if (dbDeleteError) {
        console.warn('Error deleting preview database records:', dbDeleteError);
      } else {
        console.log('✅ Deleted preview database records');
      }

      // STEP 2: Delete the ENTIRE preview folder for this product
      try {
        console.log(`Deleting entire preview folder for product ${productId}...`);

        const { data: existingPreviews } = await supabase.storage
          .from('resource-previews')
          .list(`previews/${productId}`, { limit: 1000 });

        if (existingPreviews && existingPreviews.length > 0) {
          console.log(`Found ${existingPreviews.length} files in preview folder, deleting all...`);
          const previewFilesToDelete = existingPreviews
            .filter(file => file.name && !file.name.includes('.folder'))
            .map(file => `previews/${productId}/${file.name}`);

          if (previewFilesToDelete.length > 0) {
            const { error: deleteError } = await supabase.storage
              .from('resource-previews')
              .remove(previewFilesToDelete);

            if (deleteError) {
              console.warn('Error deleting preview folder:', deleteError);
            } else {
              console.log('✅ Successfully deleted entire preview folder');
              
              // Log preview files deletion
              try {
                const clientIP = event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || null;
                const userAgent = event.headers['user-agent'] || null;
                await supabase.from('admin_activity_log').insert({
                  username: tokenVerification.data.username || 'admin',
                  action: 'delete_storage_folder',
                  resource_type: 'storage',
                  resource_id: `previews/${productId}`,
                  details: {
                    folder_path: `previews/${productId}`,
                    files_deleted: previewFilesToDelete,
                    file_count: previewFilesToDelete.length,
                    bucket: 'resource-previews',
                    context: 'product_update',
                    product_id: productId
                  },
                  ip_address: clientIP,
                  user_agent: userAgent
                });
              } catch (logError) {
                console.warn('Failed to log preview files deletion:', logError);
              }
            }
          }
        } else {
          console.log('No existing preview files found');
        }
      } catch (deleteError) {
        console.warn('Error in preview folder deletion:', deleteError);
      }

      // STEP 3: Upload new preview to clean folder
      const cleanFileName = sanitizeFileName(previewFile.filename);
      const previewFileName = `previews/${productId}/${cleanFileName}`;

      console.log(`📤 Uploading new preview: ${previewFileName}`);

      const { error: previewUploadError } = await supabase.storage
        .from('resource-previews')
        .upload(previewFileName, previewFile.content, {
          contentType: previewFile.contentType,
          metadata: {
            productId: productId.toString(),
            originalName: previewFile.filename,
            type: 'preview',
            uploadedAt: new Date().toISOString()
          }
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

    // Log admin activity (update_product) with resource_id as a UUID, always log after any update
    const ipRaw = event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || null;
    const clientIP = ipRaw ? String(ipRaw).split(',')[0].trim() : null;
    const userAgent = event.headers['user-agent'] || null;
    // Restore original logging: let DB default resource_id (uuid) and do not set explicitly
    const logResult = await supabase.from('admin_activity_log').insert({
      username: tokenVerification.data.username || 'admin',
      action: 'update_product',
      resource_type: 'product',
      details: {
        product_id: updatedProduct.id,
        name: updatedProduct.name,
        category: updatedProduct.category,
        price: updatedProduct.price,
        featured: updatedProduct.featured,
        timestamp: new Date().toISOString()
      },
      ip_address: clientIP,
      user_agent: userAgent
    });
    if (logResult.error) {
      console.error('Failed to log update_product to admin_activity_log:', logResult.error);
    } else {
      console.log('Logged update_product to admin_activity_log:', logResult.data);
    }

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
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);

    // Log additional context
    if (error.code) {
      console.error('Error code:', error.code);
    }
    if (error.details) {
      console.error('Error details:', error.details);
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
          code: error.code
        } : undefined
      })
    };
  }
};

function sanitizeFileName(fileName) {
  return fileName.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase();
}
