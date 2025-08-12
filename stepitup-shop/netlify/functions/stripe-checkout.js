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

  console.log('Stripe checkout called');
  console.log('Request body:', event.body);

  try {
    // Check if Stripe secret key is configured
    if (!process.env.STRIPE_SECRET_KEY) {
      console.error('STRIPE_SECRET_KEY not configured');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Stripe not configured properly" }),
      };
    }

    let requestBody;
    try {
      requestBody = JSON.parse(event.body);
    } catch (parseError) {
      console.error('Failed to parse request body:', parseError);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Invalid request format" }),
      };
    }

    const { cart } = requestBody;
    console.log('Parsed cart:', cart);

    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      console.error('Invalid cart data:', cart);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Cart is empty or invalid" }),
      };
    }

    // Validate all cart items
    for (const item of cart) {
      if (!item.id || !item.name || typeof item.price !== 'number') {
        console.error('Invalid cart item:', item);
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Invalid cart item data" }),
        };
      }
    }

    console.log('Creating line items...');

    // Create line items for Stripe checkout
    const lineItems = cart.map(item => {
      const lineItem = {
        price_data: {
          currency: 'usd',
          product_data: {
            name: item.name,
            description: item.description || 'Educational resource from Step it Up Learning',
            metadata: {
              product_id: item.id.toString(),
              resource_path: item.resource_path || ''
            }
          },
          unit_amount: parseInt(item.price), // Price in cents
        },
        quantity: 1, // Digital products are always quantity 1
      };
      console.log('Created line item:', lineItem);
      return lineItem;
    });

    // For multiple items, we'll store the cart data in metadata
    const cartMetadata = {
      cart_items: JSON.stringify(cart.map(item => ({
        id: item.id,
        name: item.name,
        resource_path: item.resource_path
      }))),
      item_count: cart.length.toString(),
      store_name: 'Step it Up Resource Store'
    };

    // If only one item, add its ID to metadata for backward compatibility
    if (cart.length === 1) {
      cartMetadata.product_id = cart[0].id.toString();
    }

    console.log('Cart metadata:', cartMetadata);

    const sessionConfig = {
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${process.env.URL || 'http://localhost:8888'}/pages/confirmation.html?session_id={CHECKOUT_SESSION_ID}&success=true`,
      cancel_url: `${process.env.URL || 'http://localhost:8888'}/index.html?canceled=true`,
      metadata: cartMetadata,
      customer_creation: 'always',
      billing_address_collection: 'auto',
      // Remove problematic configurations for now
    };

    console.log('Creating Stripe session with config:', JSON.stringify(sessionConfig, null, 2));

    const session = await stripe.checkout.sessions.create(sessionConfig);

    console.log('Stripe session created:', session.id);

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
    console.error('Error stack:', error.stack);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: "Failed to create checkout session",
        details: error.message,
        type: error.type || 'unknown_error'
      }),
    };
  }
};