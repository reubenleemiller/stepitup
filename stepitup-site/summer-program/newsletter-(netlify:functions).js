// netlify/functions/newsletter.js

// Use dynamic import to support node-fetch v3+ with CommonJS
let fetch = global.fetch;
if (!fetch) {
  fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
}
const { Resend } = require('resend');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const PDF_STORAGE_BUCKET = process.env.PDF_STORAGE_BUCKET;
  const PDF_FILE_PATH = process.env.PDF_FILE_PATH;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  try {
    const { email } = JSON.parse(event.body);

    // Validate email
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid email address.' }) };
    }

    // Upsert email (no duplicates)
    const upsertPayload = [{ email, confirmed: false }];

    const subRes = await fetch(`${SUPABASE_URL}/rest/v1/newsletter_emails?on_conflict=email`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(upsertPayload)
    });

    if (!subRes.ok) {
      const errorText = await subRes.text();
      console.error('Supabase error:', errorText);
      return { statusCode: 400, body: JSON.stringify({ error: errorText }) };
    }

    // Get signed URL for the PDF (15 min expiry)
    const pdfRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${PDF_STORAGE_BUCKET}/${PDF_FILE_PATH}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ expiresIn: 900 })
    });

    if (!pdfRes.ok) {
      const errorText = await pdfRes.text();
      console.error('PDF link error:', errorText);
      return { statusCode: 400, body: JSON.stringify({ error: errorText }) };
    }
    const data = await pdfRes.json();
    if (!data.signedURL) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No signed URL received' }) };
    }

    // Download the PDF from Supabase Storage using the signed URL
    const pdfDownloadUrl = `${SUPABASE_URL}/storage/v1${data.signedURL}`;
    const pdfFileRes = await fetch(pdfDownloadUrl);
    if (!pdfFileRes.ok) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Could not download PDF file.' }) };
    }
    // node-fetch v3+ returns a web-compatible Response, so use .arrayBuffer()
    const pdfArrayBuffer = await pdfFileRes.arrayBuffer();
    const pdfBuffer = Buffer.from(pdfArrayBuffer);

    // Build the new, longer, detailed email template based on your homepage and previous AI draft
    const btnStyle = "background:#2B76CC;color:#fff;padding:10px 20px;text-decoration:none;border-radius:5px;display:inline-block;margin:8px 0;font-weight:bold;";
    const sectionTitle = "color:#2B76CC;font-size:1.2em;margin-top:32px;margin-bottom:8px;";

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; color: #222; max-width: 700px; margin: auto;">
        <h2 style="color: #2B76CC;">Welcome to Step it Up Learning!</h2>
        <p>Thank you for signing up! Your Summer Reading Bingo sheet is attached as a PDF.</p>
        <p>Don't forget to email us pictures of the books you've read when you complete a bingo, so you can be entered to win a $10 Indigo Electronic Gift Card</p>
        <p>If you're interested in learning more about our other services please read below.</p>
        
        <h3 style="${sectionTitle}">Step it up Tutoring Packages for Kinder–Grade 6</h3>
        <ul>
          <li><b>Kinder–Grade 1:</b>
            <ul>
              <li><b>Math:</b> Number sense, fine motor skills, basics for school readiness</li>
              <li><b>Language:</b> Letters, sounds, vocabulary, following instructions</li>
              <li><b>Both Packages:</b> Save when you bundle</li>
            </ul>
          </li>
          <li><b>Grade 2–3:</b>
            <ul>
              <li><b>Math:</b> Addition/subtraction, place value, graphs</li>
              <li><b>Language:</b> Reading fluency, story structure, writing sentences</li>
              <li><b>Both Packages:</b> Save when you bundle</li>
            </ul>
          </li>
          <li><b>Grade 4–5:</b>
            <ul>
              <li><b>Math:</b> Multiplication/division, fractions, decimals, number concepts</li>
              <li><b>Language:</b> Paragraph writing, reading comprehension, public speaking</li>
              <li><b>Both Packages:</b> Save when you bundle</li>
            </ul>
          </li>
          <li><b>Grade 6:</b>
            <ul>
              <li><b>Math:</b> Advanced operations, algebra, coordinate grids</li>
              <li><b>Language:</b> Reading for inference, opinion writing, French support</li>
              <li><b>Both Packages:</b> Save when you bundle</li>
            </ul>
          </li>
        </ul>
        <ul>
          <li><b>Sibling Discount:</b> <a href="https://www.stepituplearning.ca/pages/coupon-request" style="color:#2B76CC;text-decoration:underline;">Request a coupon here</a></li>
        </ul>
        <p>
          <a href="https://packages.stepituplearning.ca" style="${btnStyle}">View Packages & Pricing</a>
        </p>

        <h3 style="${sectionTitle}">General Tutoring Sessions</h3>
        <p>
          Want to book a single 60-minute session? You can reserve a general tutoring slot for any subject at any time:
          <br/>
          <a href="https://booking.stepituplearning.ca/rebeccamiller/60min" style="${btnStyle}">Book a 60-Minute Session</a>
        </p>

        <h3 style="${sectionTitle}">Meet & Greet</h3>
        <p>
          Not sure which package is right for you, or want to discuss your child's goals? Book a free 15‑minute Meet & Greet to:
          <ul>
            <li>Discuss your child's needs and learning style</li>
            <li>Explore our program and options</li>
            <li>Get all your questions answered!</li>
          </ul>
          <a href="https://cal.com/rebeccamiller/assessment" style="${btnStyle}">Book a Meet & Greet</a>
        </p>

        <p style="margin-top:32px;">
          We're excited to support your child's learning journey!</p>
        <p>
          --<br>
          <div style="color:#888;"><strong>Rebecca Miller</strong></div>
          <div style="color:#888;">Step it Up Learning</div>
          <a href="mailto:rebecca.miller@stepituplearning.ca">rebecca.miller@stepituplearning.ca</a><br>
          <a href="https://stepituplearning.ca" target="_blank">stepituplearning.ca</a><br>
          <img src="https://www.stepituplearning.ca/assets/logo.png" alt="Step it Up Learning" style="width:120px; margin-top:8px;" />
        </p>
      </div>
    `;

    // Send email with Resend
    const resend = new Resend(RESEND_API_KEY);

    const emailResponse = await resend.emails.send({
      from: 'Step it Up Learning <info@stepituplearning.ca>',
      to: email,
      subject: 'Your Summer Reading Bingo Sheet',
      html: htmlBody,
      attachments: [
        {
          filename: 'Summer_Reading_Bingo.pdf',
          content: pdfBuffer.toString('base64'),
          contentType: 'application/pdf',
        }
      ]
    });

    if (emailResponse.error) {
      console.error('Resend email error:', emailResponse.error);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to send email.' }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Form submitted and email sent!',
        downloadUrl: pdfDownloadUrl
      })
    };
  } catch (err) {
    console.error('Handler error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Internal Server Error' }) };
  }
};