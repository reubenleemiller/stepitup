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

      // Delete ALL preview files for this product
      try {
        console.log(`Searching for preview files for product ${product_id}`);
        const { data: allPreviewFiles } = await supabase.storage
          .from('resource-previews')
          .list('previews', { limit: 1000 });

        if (allPreviewFiles) {
          // Look for folders matching the product ID
          const productFolders = allPreviewFiles.filter(item =>
            item.name === product_id.toString() && item.id === null
          );

          console.log(`Found ${productFolders.length} preview folders for product ${product_id}`);

          // For each folder, get all files inside
          for (const folder of productFolders) {
            const { data: folderFiles } = await supabase.storage
              .from('resource-previews')
              .list(`previews/${folder.name}`);

            if (folderFiles) {
              folderFiles.forEach(file => {
                if (file.name && !file.name.includes('.folder')) {
                  filesToDelete.push({
                    bucket: 'resource-previews',
                    path: `previews/${folder.name}/${file.name}`
                  });
                }
              });
            }
          }
        }
      } catch (previewListError) {
        console.warn('Error listing preview files for deletion:', previewListError);
      }

      // Delete ALL resource images for this product
      try {
        console.log(`Searching for resource images for product ${product_id}`);
        const { data: allImageFiles } = await supabase.storage
          .from('resource-images')
          .list('resource-images', { limit: 1000 });

        if (allImageFiles) {
          // Look for folders matching the product ID
          const productFolders = allImageFiles.filter(item =>
            item.name === product_id.toString() && item.id === null
          );

          console.log(`Found ${productFolders.length} image folders for product ${product_id}`);

          // For each folder, get all files inside
          for (const folder of productFolders) {
            const { data: folderFiles } = await supabase.storage
              .from('resource-images')
              .list(`resource-images/${folder.name}`);

            if (folderFiles) {
              folderFiles.forEach(file => {
                if (file.name && !file.name.includes('.folder')) {
                  filesToDelete.push({
                    bucket: 'resource-images',
                    path: `resource-images/${folder.name}/${file.name}`
                  });
                }
              });
            }
          }
        }
      } catch (imageListError) {
        console.warn('Error listing image files for deletion:', imageListError);
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
