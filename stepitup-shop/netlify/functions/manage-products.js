const { createClient } = require('@supabase/supabase-js');
const { verifyAdminToken } = require('./admin-auth');

exports.handler = async (event, context) => {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Require admin auth for all operations
    const authHeader = event.headers['authorization'] || event.headers['Authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
    const token = authHeader.replace('Bearer ', '');
    const tokenVerification = verifyAdminToken(token);
    if (!tokenVerification.valid) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired token' }) };
    }

    const { httpMethod } = event;

    if (httpMethod === 'GET') {
      // Get all products for admin management
      const { data: products, error } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching products:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to fetch products' })
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          products: products || []
        })
      };

    } else if (httpMethod === 'DELETE') {
      const { product_id } = event.queryStringParameters || {};

      if (!product_id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'product_id is required' })
        };
      }

      // Get product details before deletion for logging and cleanup
      const { data: productData, error: fetchError } = await supabase
        .from('products')
        .select('name, resource_path, image_url')
        .eq('id', product_id)
        .single();

      if (fetchError) {
        console.error('Error fetching product for deletion:', fetchError);
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Product not found' })
        };
      }

      // Delete associated previews from database first
      const { error: previewDeleteError } = await supabase
        .from('paid_resource_previews')
        .delete()
        .eq('product_id', product_id);

      if (previewDeleteError) {
        console.warn('Error deleting previews from database:', previewDeleteError);
      }

      // Delete associated reviews from all possible review tables
      const reviewTables = ['reviews', 'product_reviews', 'customer_reviews'];
      for (const table of reviewTables) {
        try {
          const { error: reviewDeleteError } = await supabase
            .from(table)
            .delete()
            .eq('product_id', product_id);

          if (reviewDeleteError && !reviewDeleteError.message.includes('does not exist')) {
            console.warn(`Error deleting from ${table}:`, reviewDeleteError);
          } else if (!reviewDeleteError) {
            console.log(`Successfully deleted reviews from ${table}`);
          }
        } catch (err) {
          console.warn(`Table ${table} might not exist:`, err.message);
        }
      }

      // Delete files from storage - with proper error handling and path correction
      const filesToDelete = [];

      // Add main product file
      if (productData.resource_path) {
        filesToDelete.push({
          bucket: 'paid-resources',
          path: productData.resource_path
        });
      }

      // Also check for product files in the products folder
      try {
        console.log(`Searching for additional product files for product ${product_id}`);
        const { data: productFiles } = await supabase.storage
          .from('paid-resources')
          .list(`products/${product_id}`);

        if (productFiles && productFiles.length > 0) {
          console.log(`Found ${productFiles.length} additional product files`);
          productFiles.forEach(file => {
            if (file.name && !file.name.includes('.folder')) {
              filesToDelete.push({
                bucket: 'paid-resources',
                path: `products/${product_id}/${file.name}`
              });
            }
          });
        }
      } catch (productListError) {
        console.warn('Error listing product files for deletion:', productListError);
      }

      // Delete ALL preview files for this product, including .folder marker files
      try {
        const { v4: uuidv4 } = require('uuid');
        console.log(`Deleting all files and subfolders in preview folder for product ${product_id}`);
        // Recursively delete all files in the folder and subfolders
        const listAllFiles = async (prefix) => {
          let allFiles = [];
          const { data: files, error } = await supabase.storage.from('resource-previews').list(prefix);
          if (error) { console.warn('Error listing files:', error); return allFiles; }
          for (const file of files) {
            if (file.id === null) {
              // It's a folder
              allFiles = allFiles.concat(await listAllFiles(`${prefix}/${file.name}`));
            } else {
              allFiles.push(`${prefix}/${file.name}`);
            }
          }
          return allFiles;
        };
        let allPreviewFiles = await listAllFiles(`previews/${product_id}`);
        console.log('Preview files to delete:', allPreviewFiles);
        // Delete all files except .folder, then check for .folder and delete it too
        const nonFolderFiles = allPreviewFiles.filter(f => !f.endsWith('.folder'));
        if (nonFolderFiles.length > 0) {
          const { error: deleteError } = await supabase.storage.from('resource-previews').remove(nonFolderFiles);
          if (deleteError) console.warn('Error deleting preview files:', deleteError);
          filesToDelete.push(...nonFolderFiles.map(path => ({ bucket: 'resource-previews', path })));
        }
        // Now check for .folder marker files and delete them
        const folderMarkerFiles = allPreviewFiles.filter(f => f.endsWith('.folder'));
        if (folderMarkerFiles.length > 0) {
          const { error: folderDeleteError } = await supabase.storage.from('resource-previews').remove(folderMarkerFiles);
          if (folderDeleteError) console.warn('Error deleting .folder marker files:', folderDeleteError);
          filesToDelete.push(...folderMarkerFiles.map(path => ({ bucket: 'resource-previews', path })));
        }
        // Log preview folder deletion
        if (allPreviewFiles.length > 0) {
          try {
            const ipRaw = event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || null;
            const clientIP = ipRaw ? String(ipRaw).split(',')[0].trim() : null;
            const userAgent = event.headers['user-agent'] || null;
            await supabase.from('admin_activity_log').insert({
              username: tokenVerification.data.username || 'admin',
              action: 'delete_storage_folder',
              resource_type: 'storage',
              resource_id: uuidv4(),
              details: {
                folder_path: `previews/${product_id}`,
                files_deleted: allPreviewFiles,
                file_count: allPreviewFiles.length,
                bucket: 'resource-previews',
                context: 'product_delete',
                product_id: product_id
              },
              ip_address: clientIP,
              user_agent: userAgent
            });
          } catch (logError) {
            console.warn('Failed to log preview folder deletion:', logError);
          }
        }
      } catch (previewListError) {
        console.warn('Error deleting preview folder:', previewListError);
      }

      // Delete ALL resource images for this product, including .folder marker files
      try {
        const { v4: uuidv4 } = require('uuid');
        console.log(`Deleting all files and subfolders in resource-images folder for product ${product_id}`);
        // Recursively delete all files in the folder and subfolders
        const listAllFiles = async (prefix) => {
          let allFiles = [];
          const { data: files, error } = await supabase.storage.from('resource-images').list(prefix);
          if (error) { console.warn('Error listing files:', error); return allFiles; }
          for (const file of files) {
            if (file.id === null) {
              // It's a folder
              allFiles = allFiles.concat(await listAllFiles(`${prefix}/${file.name}`));
            } else {
              allFiles.push(`${prefix}/${file.name}`);
            }
          }
          return allFiles;
        };
        let allImageFiles = await listAllFiles(`resource-images/${product_id}`);
        console.log('Resource image files to delete:', allImageFiles);
        // Delete all files except .folder, then check for .folder and delete it too
        const nonFolderFiles = allImageFiles.filter(f => !f.endsWith('.folder'));
        if (nonFolderFiles.length > 0) {
          const { error: deleteError } = await supabase.storage.from('resource-images').remove(nonFolderFiles);
          if (deleteError) console.warn('Error deleting resource image files:', deleteError);
          filesToDelete.push(...nonFolderFiles.map(path => ({ bucket: 'resource-images', path })));
        }
        // Now check for .folder marker files and delete them
        const folderMarkerFiles = allImageFiles.filter(f => f.endsWith('.folder'));
        if (folderMarkerFiles.length > 0) {
          const { error: folderDeleteError } = await supabase.storage.from('resource-images').remove(folderMarkerFiles);
          if (folderDeleteError) console.warn('Error deleting .folder marker files:', folderDeleteError);
          filesToDelete.push(...folderMarkerFiles.map(path => ({ bucket: 'resource-images', path })));
        }
        // Log resource_images folder deletion
        if (allImageFiles.length > 0) {
          try {
            const ipRaw = event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || null;
            const clientIP = ipRaw ? String(ipRaw).split(',')[0].trim() : null;
            const userAgent = event.headers['user-agent'] || null;
            await supabase.from('admin_activity_log').insert({
              username: tokenVerification.data.username || 'admin',
              action: 'delete_storage_folder',
              resource_type: 'storage',
              resource_id: uuidv4(),
              details: {
                folder_path: `resource-images/${product_id}`,
                files_deleted: allImageFiles,
                file_count: allImageFiles.length,
                bucket: 'resource-images',
                context: 'product_delete',
                product_id: product_id
              },
              ip_address: clientIP,
              user_agent: userAgent
            });
          } catch (logError) {
            console.warn('Failed to log resource_images folder deletion:', logError);
          }
        }
      } catch (imageListError) {
        console.warn('Error deleting resource_images folder:', imageListError);
      }

      // Delete files from storage buckets - group by bucket for efficiency
      const bucketGroups = {};
      filesToDelete.forEach(file => {
        if (!bucketGroups[file.bucket]) {
          bucketGroups[file.bucket] = [];
        }
        bucketGroups[file.bucket].push(file.path);
      });

      for (const [bucket, paths] of Object.entries(bucketGroups)) {
        if (paths.length > 0) {
          try {
            const { error: deleteError } = await supabase.storage
              .from(bucket)
              .remove(paths);

            if (deleteError) {
              console.warn(`Error deleting files from ${bucket}:`, deleteError);
            } else {
              console.log(`Successfully deleted ${paths.length} files from ${bucket}`);
            }
          } catch (err) {
            console.warn(`Failed to delete from bucket ${bucket}:`, err.message);
          }
        }
      }

      // Delete the product record
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', product_id);

      if (error) {
        console.error('Error deleting product:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to delete product' })
        };
      }

      // Clear all possible caches for this product
      try {
        // In-memory cache clearing (this won't work across serverless functions, but good practice)
        console.log(`Clearing cache for product ${product_id}`);

        // If we had Redis access, we'd clear it here, but without working Redis,
        // we rely on cache TTL expiration
      } catch (cacheError) {
        console.warn('Error clearing cache:', cacheError);
      }

      // Log admin activity
      const ipRaw = event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || null;
      const clientIP = ipRaw ? String(ipRaw).split(',')[0].trim() : null;
      const userAgent = event.headers['user-agent'] || null;
      try {
        await supabase.from('admin_activity_log').insert({
          username: tokenVerification.data.username || 'admin',
          action: 'delete_product',
          resource_type: 'product',
          details: {
            product_id: Number(product_id),
            product_name: productData.name,
            files_deleted: filesToDelete.map(f => f.path),
            timestamp: new Date().toISOString()
          },
          ip_address: clientIP,
          user_agent: userAgent
        });
      } catch (logError) {
        console.warn('Failed to log admin activity:', logError);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Product and all associated data deleted successfully',
          deleted_files: filesToDelete.length
        })
      };

    } else {
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }

  } catch (error) {
    console.error('Unexpected error in manage-products:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};
