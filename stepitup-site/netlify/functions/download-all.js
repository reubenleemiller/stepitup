const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('./db.js');
const JSZip = require('jszip');

exports.handler = async function(event, context) {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
    'Content-Type': 'application/octet-stream'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: ''
    };
  }

  try {
    const session_id = event.queryStringParameters.session_id;
    
    if (!session_id) {
      return {
        statusCode: 400,
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: "Session ID is required" }),
      };
    }

    // Retrieve Stripe session
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== 'paid') {
      return {
        statusCode: 400,
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: "Payment not completed" }),
      };
    }

    // Get customer email for verification
    const email = session.customer_details?.email || session.customer_email;
    if (!email) {
      return {
        statusCode: 400,
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: "No email found for this session." }),
      };
    }

    // Handle multiple items from cart metadata
    let cartItems = [];
    let products = [];

    try {
      if (session.metadata && session.metadata.cart_items) {
        cartItems = JSON.parse(session.metadata.cart_items);
      } else if (session.metadata && session.metadata.product_id) {
        cartItems = [{ id: session.metadata.product_id }];
      } else {
        throw new Error("No product information found in session metadata");
      }

      // Get all products and their file URLs
      for (const cartItem of cartItems) {
        const productId = cartItem.id;
        const product = await db.getProductById(productId);
        
        if (!product) {
          console.error(`Product not found: ${productId}`);
          continue;
        }

        products.push(product);
      }

      if (products.length === 0) {
        return {
          statusCode: 404,
          headers: {
            ...headers,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ error: "No valid products found for this purchase" }),
        };
      }

    } catch (error) {
      console.error('Error processing cart items:', error);
      return {
        statusCode: 500,
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ error: "Failed to process purchased items" }),
      };
    }

    // Create a ZIP file with all the resources
    const zip = new JSZip();
    
    try {
      // Add each product file to the zip
      for (const product of products) {
        if (!product.resource_path) {
          console.warn(`No resource path for product: ${product.name}`);
          continue;
        }

        try {
          // Generate signed URL for this product
          const signedResponse = await fetch(`${process.env.URL || 'https://localhost:8888'}/.netlify/functions/generate-signed-url?resource=${encodeURIComponent(product.resource_path)}`);
          
          if (!signedResponse.ok) {
            console.error(`Failed to generate signed URL for ${product.name}: ${signedResponse.status}`);
            continue;
          }
          
          const signedData = await signedResponse.json();
          
          // Fetch the actual file content
          const fileResponse = await fetch(signedData.signedUrl);
          
          if (!fileResponse.ok) {
            console.error(`Failed to fetch file for ${product.name}: ${fileResponse.status}`);
            continue;
          }

          const fileBuffer = await fileResponse.arrayBuffer();
          
          // Get file extension from resource path
          const fileName = product.resource_path.split('/').pop() || `${product.name}.pdf`;
          const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
          
          // Add file to zip with product name prefix
          const zipFileName = `${product.name.replace(/[^a-zA-Z0-9.-]/g, '_')}_${sanitizedFileName}`;
          zip.file(zipFileName, fileBuffer);
          
          console.log(`Added ${zipFileName} to zip`);
          
        } catch (fileError) {
          console.error(`Error processing file for ${product.name}:`, fileError);
          // Continue with other files even if one fails
        }
      }

      // Generate the ZIP file
      const zipBuffer = await zip.generateAsync({
        type: 'uint8array',
        compression: 'DEFLATE',
        compressionOptions: {
          level: 6
        }
      });

      if (zipBuffer.length === 0) {
        return {
          statusCode: 500,
          headers: {
            ...headers,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ error: "Failed to create zip file - no files were added" }),
        };
      }

      // Convert to base64 for response
      const zipBase64 = Buffer.from(zipBuffer).toString('base64');

      // Set headers for file download
      const downloadHeaders = {
        ...headers,
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="StepItUp_Resources_${session_id.substring(0, 8)}.zip"`,
        'Content-Length': zipBuffer.length.toString(),
        'Cache-Control': 'no-cache'
      };

      return {
        statusCode: 200,
        headers: downloadHeaders,
        body: zipBase64,
        isBase64Encoded: true
      };

    } catch (zipError) {
      console.error('Error creating zip file:', zipError);
      return {
        statusCode: 500,
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          error: "Failed to create zip file",
          details: zipError.message 
        }),
      };
    }

  } catch (error) {
    console.error('Download all error:', error);
    return {
      statusCode: 500,
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        error: "Failed to process download request",
        details: error.message 
      }),
    };
  }
};