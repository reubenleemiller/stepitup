import { createClient } from '@supabase/supabase-js';
import busboy from 'busboy';
import { PassThrough } from 'stream';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Use secure service role key for uploads
);

export const handler = async (event) => {
  console.log('submit-review function invoked');

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed, use POST' }),
    };
  }

  try {
    const contentType = event.headers['content-type'] || event.headers['Content-Type'];
    if (!contentType) {
      throw new Error('Missing Content-Type header');
    }

    // Prepare incoming request body as stream
    const buffer = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8');
    const stream = new PassThrough();
    stream.end(buffer);

    // Parse multipart form data
    const formData = await new Promise((resolve, reject) => {
      const bb = busboy({ headers: { 'content-type': contentType } });
      const fields = {};
      const files = {};

      bb.on('field', (name, val) => {
        fields[name] = val;
      });

      bb.on('file', (fieldname, file, info) => {
        const { filename, mimeType } = info;
        const chunks = [];
        file.on('data', (chunk) => chunks.push(chunk));
        file.on('end', () => {
          files[fieldname] = {
            filename,
            contentType: mimeType,
            content: Buffer.concat(chunks),
          };
        });
      });

      bb.on('error', (err) => {
        console.error('Busboy error:', err);
        reject(err);
      });

      bb.on('finish', () => {
        resolve({ ...fields, ...files });
      });

      stream.pipe(bb);
    });

    // Accept new fields for email and phone
    const { name, review, rating, image, email, phone } = formData;
    if (!name || !review || !rating || !image) {
      console.error('Missing fields:', { name, review, rating, image });
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields' }),
      };
    }
    if (!email && !phone) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Please provide at least an email or phone' }),
      };
    }

    // Sanitize and upload the image
    const safeFilename = sanitizeFilename(`${Date.now()}_${image.filename}`);
    console.log('Uploading image:', safeFilename);

    const { error: uploadError } = await supabase.storage
      .from('review-images')
      .upload(safeFilename, image.content, {
        contentType: image.contentType,
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      throw new Error('Image upload failed: ' + uploadError.message);
    }

    // Get public URL
    const { data: publicUrlData, error: urlError } = supabase
      .storage
      .from('review-images')
      .getPublicUrl(safeFilename);

    if (urlError) {
      console.error('Get public URL error:', urlError);
      throw new Error('Failed to get public URL: ' + urlError.message);
    }

    const publicUrl = publicUrlData.publicUrl;
    console.log('Public URL:', publicUrl);

    // Insert review into DB with new fields
    const { error: insertError } = await supabase
      .from('reviews')
      .insert({
        name,
        review,
        rating: Number(rating),
        image_url: publicUrl,
        email: email || null,
        phone: phone || null,
        verified: false, // all new reviews are not verified by default
        created_at: new Date().toISOString(),
      });

    if (insertError) {
      console.error('Insert error:', insertError);
      throw new Error('Insert review failed: ' + insertError.message);
    }

    console.log('Review inserted successfully');
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error('Unhandled error in submit-review:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};

function sanitizeFilename(name) {
  return name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-\.]/g, '');
}