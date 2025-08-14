const { createClient } = require('@supabase/supabase-js');

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

      // Delete ALL preview files for this product (not just in subfolders)
      try {
        // Try multiple possible paths for preview files
        const previewPaths = [
          `previews/${product_id}`,
          `preview/${product_id}`, 
          `${product_id}`,
          ''
        ];

        for (const basePath of previewPaths) {
          try {
            const { data: previewFiles } = await supabase.storage
              .from('resource-previews')
              .list(basePath);
            
            if (previewFiles && previewFiles.length > 0) {
              previewFiles.forEach(file => {
                if (file.name && !file.name.includes('.folder')) {
                  const fullPath = basePath ? `${basePath}/${file.name}` : file.name;
                  filesToDelete.push({
                    bucket: 'resource-previews',
                    path: fullPath
                  });
                }
              });
            }
          } catch (listError) {
            console.log(`No files found in path ${basePath}:`, listError.message);
          }
        }
      } catch (previewListError) {
        console.warn('Error listing preview files for deletion:', previewListError);
      }

      // Delete ALL resource images for this product
      try {
        const imagePaths = [
          `resource-images/${product_id}`,
          `images/${product_id}`,
          `${product_id}`,
          ''
        ];

        for (const basePath of imagePaths) {
          try {
            const { data: imageFiles } = await supabase.storage
              .from('resource-images')
              .list(basePath);
            
            if (imageFiles && imageFiles.length > 0) {
              imageFiles.forEach(file => {
                if (file.name && !file.name.includes('.folder')) {
                  const fullPath = basePath ? `${basePath}/${file.name}` : file.name;
                  filesToDelete.push({
                    bucket: 'resource-images',
                    path: fullPath
                  });
                }
              });
            }
          } catch (listError) {
            console.log(`No files found in path ${basePath}:`, listError.message);
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
      const clientIP = event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || 'unknown';
      const userAgent = event.headers['user-agent'] || 'unknown';
      
      try {
        await supabase.rpc('log_admin_activity', {
          p_username: 'admin',
          p_action: 'delete_product',
          p_resource_type: 'product',
          p_resource_id: product_id.toString(),
          p_details: { 
            product_name: productData.name,
            files_deleted: filesToDelete.map(f => f.path),
            timestamp: new Date().toISOString()
          },
          p_ip_address: clientIP,
          p_user_agent: userAgent
        });
      } catch (logError) {
        console.warn('Failed to log admin activity:', logError);
        // Don't fail the request if logging fails
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