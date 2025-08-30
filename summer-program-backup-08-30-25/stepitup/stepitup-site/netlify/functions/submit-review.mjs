import { createClient } from '@supabase/supabase-js';
import busboy from 'busboy';
import { PassThrough } from 'stream';

// Polyfill fetch if needed (node <18)
import fetch from 'node-fetch';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Use secure service role key for uploads
);

// Email/Phone validation helpers (server-side, for redundancy)
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function isValidPhone(phone) {
  return /^[\d\-\+\(\) ]{7,}$/.test(phone) && phone.replace(/\D/g, '').length >= 7;
}

// Subject helper: "New Review from Firstname L."
function getNotificationSubject(name) {
  if (!name || typeof name !== 'string') return 'New Review';
  const parts = name.trim().split(/\s+/);
  let first = parts[0] || '';
  let last = parts.length > 1 ? parts[parts.length - 1] : '';
  if (first) first = first[0].toUpperCase() + first.slice(1).toLowerCase();
  if (last) last = last[0].toUpperCase() + last.slice(1).toLowerCase();
  if (first && last) return `New Review from ${first} ${last[0]}.`;
  if (first) return `New Review from ${first}`;
  return `New Review`;
}

// Returns the HTML for a review card with blue quotes, centered content, and Unicode stars
function getReviewCardHtml({ image_url, name, verified, rating, review }) {
  const quoteLeft = '“';
  const quoteRight = '”';
  const stars = '★'.repeat(Number(rating));
  return `
  <div style="max-width:380px;margin:24px auto 32px auto;background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.04);padding:22px;text-align:center;display:block;">
    <img src="${image_url}" alt="${name}" style="width:64px;height:64px;object-fit:cover;border-radius:50%;border:2px solid #eee;margin-bottom:12px;"/>
    <div style="font-weight:600;margin-top:0;margin-bottom:4px;">
      ${name}
      ${verified === 'true' || verified === true ? 
        '<span style="color:#6CCE35; font-size:1.2rem;vertical-align:-1px;" title="Verified Reviewer">✔️</span>' : ''}
    </div>
    <div style="margin:10px 0;font-size:1.45rem;color:#FFD700;letter-spacing:0.1em;text-shadow:0 1px 0 #fff;">${stars}</div>
    <div style="color:#444;font-size:1.09rem;line-height:1.5;position:relative;display:block;padding:0 14px 0 14px;text-align:center;margin-top:12px;">
      <div style="text-align:left;color:#2c77cc;font-size:2.2em;font-weight:bold;margin-bottom:-8px;line-height:1;">${quoteLeft}</div>
      <div style="padding:0 20px;">${review}</div>
      <div style="text-align:right;color:#2c77cc;font-size:2.2em;font-weight:bold;margin-top:-8px;line-height:1;">${quoteRight}</div>
    </div>
  </div>
  `;
}

// Send notification using Resend with sender name set to Rebecca Miller
async function sendResendNotification({ review, rating, name, image_url, verified }) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.error("No RESEND_API_KEY set, cannot send notification");
    return;
  }

  const subject = getNotificationSubject(name);

  const cardHtml = getReviewCardHtml({ image_url, name, verified, rating, review });

  const html = `
    <h2 style="margin:24px 0 0.5em 0;text-align:center;">New Review Received</h2>
    ${cardHtml}
    <div style="margin-top:32px;font-size:1.05em;line-height:1.7;">
      &mdash;<br>
      <span style="font-weight:600;">Step it Up Learning</span><br>
      <a href="mailto:info@stepituplearning.ca" style="color:#2c77cc;text-decoration:none;">info@stepituplearning.ca</a><br>
      <a href="https://stepituplearning.ca" style="color:#2c77cc;text-decoration:none;">stepituplearning.ca</a><br>
      <img src="https://stepituplearning.ca/assets/logo.png" alt="Step it Up Learning Logo" style="height: 160px;margin-top:8px;">
    </div>
  `;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Rebecca Miller <info@stepituplearning.ca>',
        to: ['rebecca.miller@stepituplearning.ca'],
        subject,
        html,
      }),
    });
  } catch (err) {
    console.error("Failed to send Resend notification:", err);
  }
}

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

    // Validate at least one contact method
    if ((!email || email.trim() === '') && (!phone || phone.trim() === '')) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Please provide at least an email or phone' }),
      };
    }
    // Validate email if present
    if (email && email.trim() && !isValidEmail(email.trim())) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid email address', field: 'email' }),
      };
    }
    // Validate phone if present
    if (phone && phone.trim() && !isValidPhone(phone.trim())) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid phone number', field: 'phone' }),
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

    // === SEND NOTIFICATION TO ADMIN ===
    await sendResendNotification({
      review,
      rating: Number(rating),
      name,
      image_url: publicUrl,
      verified: false,
    });

    console.log('Review inserted successfully');
    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error('Unhandled error in submit-review:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message, field: error.field }),
    };
  }
};

function sanitizeFilename(name) {
  return name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-\.]/g, '');
}