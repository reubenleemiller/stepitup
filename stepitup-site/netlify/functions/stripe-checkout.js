const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { cart } = JSON.parse(event.body);

    // Validate cart
    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Cart is empty or invalid" }),
      };
    }

    // Only allow single-item cart for now (simplifies resource delivery)
    if (cart.length !== 1) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Only one resource can be purchased at a time for secure delivery." }),
      };
    }

    const product = cart[0];

    // Validate product data
    if (!product.id || !product.name || typeof product.price !== 'number') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Invalid product data" }),
      };
    }

    // Ensure price is positive integer (in cents)
    const unitAmount = Math.round(Math.abs(product.price));
    if (unitAmount < 50) { // Minimum $0.50
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Product price is too low" }),
      };
    }

    // Determine base URL
    const baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://localhost:8888';

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { 
            name: product.name,
            description: product.description || 'Educational resource from Step it Up Learning',
            metadata: {
              product_id: product.id.toString()
            }
          },
          unit_amount: unitAmount,
        },
        quantity: product.quantity || 1
      }],
      mode: 'payment',
      success_url: `${baseUrl}/pages/confirmation.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/pages/store.html`,
      metadata: {
        product_id: product.id.toString(),
        product_name: product.name,
        product_category: product.category || 'resource'
      },
      customer_creation: 'always',
      billing_address_collection: 'auto',
      phone_number_collection: {
        enabled: false
      },
      allow_promotion_codes: true,
      tax_id_collection: {
        enabled: false
      },
      custom_text: {
        submit: {
          message: 'Your resource will be available for download immediately after payment.'
        }
      },
      invoice_creation: {
        enabled: true,
        invoice_data: {
          description: `Purchase of ${product.name} from Step it Up Learning`,
          metadata: {
            product_id: product.id.toString(),
            source: 'stepitup_store'
          }
        }
      }
    });

    console.log('Stripe session created:', {
      session_id: session.id,
      product_id: product.id,
      amount: unitAmount
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        url: session.url,
        session_id: session.id 
      }),
    };

  } catch (error) {
    console.error('Stripe checkout error:', error);
    
    // Return user-friendly error messages
    let errorMessage = 'Failed to create checkout session';
    
    if (error.type === 'StripeCardError') {
      errorMessage = 'There was an issue with your payment method';
    } else if (error.type === 'StripeRateLimitError') {
      errorMessage = 'Too many requests. Please try again later';
    } else if (error.type === 'StripeInvalidRequestError') {
      errorMessage = 'Invalid payment request. Please try again';
    } else if (error.type === 'StripeAPIError') {
      errorMessage = 'Payment service temporarily unavailable';
    } else if (error.type === 'StripeConnectionError') {
      errorMessage = 'Network error. Please check your connection';
    }
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: errorMessage,
        code: error.type || 'unknown_error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      }),
    };
  }
};