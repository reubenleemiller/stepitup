const { createClient } = require('@supabase/supabase-js');
const formidable = require('formidable');

exports.handler = async (event, context) => {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Parse the multipart form data
    const form = new formidable.IncomingForm();
    form.maxFileSize = 5 * 1024 * 1024; // 5MB limit for images
    form.keepExtensions = true;
    
    return new Promise((resolve, reject) => {
      form.parse(event.body, async (err, fields, files) => {
        if (err) {
          console.error('Form parsing error:', err);
          resolve({
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Failed to parse form data' })
          });
          return;
        }

        try {
          const uploadResults = [];
          const uploadType = fields.uploadType || 'resource-images';
          
          // Handle multiple files
          const fileArray = Array.isArray(files.images) ? files.images : [files.images].filter(Boolean);
          
          for (const file of fileArray) {
            if (!file) continue;

            // Read file buffer
            const fs = require('fs');
            const fileBuffer = fs.readFileSync(file.filepath);
            
            // Generate unique filename
            const timestamp = Date.now();
            const randomString = Math.random().toString(36).substring(7);
            const extension = file.mimetype.split('/')[1];
            const fileName = `${uploadType}-${timestamp}-${randomString}.${extension}`;
            
            // Upload to Supabase storage
            const { data, error } = await supabase.storage
              .from('resource-images')
              .upload(fileName, fileBuffer, {
                contentType: file.mimetype,
                upsert: false
              });

            if (error) {
              console.error('Storage upload error:', error);
              resolve({
                statusCode: 500,
                headers,
                body: JSON.stringify({ 
                  error: 'Failed to upload image',
                  details: error.message 
                })
              });
              return;
            }

            // Get public URL
            const { data: publicUrl } = supabase.storage
              .from('resource-images')
              .getPublicUrl(fileName);

            uploadResults.push({
              fileName,
              publicUrl: publicUrl.publicUrl,
              originalName: file.originalFilename,
              size: file.size,
              type: file.mimetype
            });
          }

          // Log admin activity
          const clientIP = event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || 'unknown';
          const userAgent = event.headers['user-agent'] || 'unknown';
          
          try {
            await supabase.rpc('log_admin_activity', {
              p_username: 'admin',
              p_action: 'upload_images',
              p_resource_type: 'image',
              p_resource_id: null,
              p_details: { 
                upload_type: uploadType,
                files_count: uploadResults.length,
                file_names: uploadResults.map(r => r.fileName),
                timestamp: new Date().toISOString()
              },
              p_ip_address: clientIP,
              p_user_agent: userAgent
            });
          } catch (logError) {
            console.warn('Failed to log admin activity:', logError);
          }

          resolve({
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              uploads: uploadResults,
              message: `Successfully uploaded ${uploadResults.length} image(s)`
            })
          });

        } catch (uploadError) {
          console.error('Upload processing error:', uploadError);
          resolve({
            statusCode: 500,
            headers,
            body: JSON.stringify({ 
              error: 'Failed to process upload',
              message: uploadError.message 
            })
          });
        }
      });
    });

  } catch (error) {
    console.error('Unexpected error in upload-images:', error);
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