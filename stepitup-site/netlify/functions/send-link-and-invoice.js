const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('./db.js');

exports.handler = async function(event, context) {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    const session_id = event.queryStringParameters.session_id;
    
    if (!session_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Session ID is required" }),
      };
    }

    // Retrieve Stripe session
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== 'paid') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Payment not completed" }),
      };
    }

    // Get customer email
    const email = session.customer_details?.email || session.customer_email;

    if (!email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "No email found for this session." }),
      };
    }

    // Get productId from Stripe session metadata
    const productId = session.metadata && session.metadata.product_id;
    if (!productId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Product ID not found in session metadata" }),
      };
    }

    // Record the purchase (with idempotency check)
    try {
      await db.addPurchase(session_id, email, productId);
    } catch (e) {
      // Ignore duplicate errors - purchase already recorded
      console.log('Purchase already recorded or error:', e.message);
    }

    // Get product info
    const product = await db.getProductById(productId);
    if (!product) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Product not found" }),
      };
    }

    const resourcePath = product.resource_path;

    // Generate signed URL for download
    let signedUrl;
    try {
      const signedResponse = await fetch(`${process.env.URL || 'https://localhost:8888'}/.netlify/functions/generate-signed-url?resource=${encodeURIComponent(resourcePath)}`);
      
      if (!signedResponse.ok) {
        throw new Error(`Failed to generate signed URL: ${signedResponse.status}`);
      }
      
      const signedData = await signedResponse.json();
      signedUrl = signedData.signedUrl;
    } catch (error) {
      console.error('Error generating signed URL:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to generate download link" }),
      };
    }

    // Send email with Resend (if API key is configured)
    if (process.env.RESEND_API_KEY) {
      try {
        const emailResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: "StepItUp Learning <noreply@stepituplearning.ca>",
            to: email,
            subject: `Your ${product.name} - Download & Invoice`,
            html: `
              <h2>Thank you for your purchase!</h2>
              <p>You have successfully purchased: <strong>${product.name}</strong></p>
              
              <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3>Download Your Resource</h3>
                <p>Click the link below to download your resource:</p>
                <a href="${signedUrl}" style="display: inline-block; background: #2c77cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0;">
                  Download ${product.name}
                </a>
                <p style="font-size: 0.9em; color: #666;">
                  <strong>Note:</strong> This download link is valid for 1 hour.
                </p>
              </div>
              
              <div style="background: #e8f5e8; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3>Need Help?</h3>
                <p>If you have any questions or issues with your download, please contact us:</p>
                <ul>
                  <li>Email: <a href="mailto:info@stepituplearning.ca">info@stepituplearning.ca</a></li>
                  <li>Phone: +1 (403) 598-4840</li>
                </ul>
                <p style="font-size: 0.9em; color: #666;">
                  Reference your Session ID: ${session_id}
                </p>
              </div>
              
              <hr style="margin: 30px 0; border: none; border-top: 1px solid #ddd;">
              <p style="font-size: 0.9em; color: #666;">
                This email was sent to ${email} regarding your purchase from StepItUp Learning.
                <br>
                © 2025 Step it Up Learning. All rights reserved.
              </p>
            `
          })
        });

        if (!emailResponse.ok) {
          console.error('Failed to send email:', await emailResponse.text());
        }
      } catch (emailError) {
        console.error('Email sending error:', emailError);
        // Don't fail the whole request if email fails
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        signedUrl,
        message: "Download link generated successfully",
        productName: product.name
      }),
    };

  } catch (error) {
    console.error('Send link error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: "Failed to process request",
        details: error.message 
      }),
    };
  }
};