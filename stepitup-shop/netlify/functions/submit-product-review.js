const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

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

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { 
      product_id, 
      customer_email, 
      customer_name, 
      rating, 
      review_title, 
      review_text,
      stripe_session_id 
    } = JSON.parse(event.body);

    // Validate required fields
    if (!product_id || !customer_email || !customer_name || !rating) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Missing required fields: product_id, customer_email, customer_name, rating' 
        })
      };
    }

    // Validate rating
    if (rating < 1 || rating > 5) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Rating must be between 1 and 5' })
      };
    }

    console.log('📝 Submitting review for product:', product_id, 'by:', customer_email);

    // Initialize Supabase client with service role for write operations
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Verify purchase if stripe_session_id is provided
    let purchase_verified = false;
    if (stripe_session_id) {
      try {
        const session = await stripe.checkout.sessions.retrieve(stripe_session_id);
        if (session.customer_details?.email === customer_email && session.payment_status === 'paid') {
          purchase_verified = true;
          console.log('✅ Purchase verified for review');
        }
      } catch (stripeError) {
        console.log('⚠️ Could not verify purchase:', stripeError.message);
      }
    }

    // Check if customer already reviewed this product
    const { data: existingReview } = await supabase
      .from('product_reviews')
      .select('id')
      .eq('product_id', product_id)
      .eq('customer_email', customer_email)
      .single();

    if (existingReview) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({ 
          error: 'You have already reviewed this product. Each customer can only submit one review per product.' 
        })
      };
    }

    // Insert the review
    const { data: review, error } = await supabase
      .from('product_reviews')
      .insert({
        product_id,
        customer_email,
        customer_name,
        rating: parseInt(rating),
        review_title: review_title || null,
        review_text: review_text || null,
        purchase_verified,
        stripe_session_id: stripe_session_id || null,
        is_approved: true, // Auto-approve for now, add moderation later if needed
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('❌ Error inserting review:', error);
      
      if (error.code === '23505') { // Unique constraint violation
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({ 
            error: 'You have already reviewed this product.' 
          })
        };
      }
      
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to submit review' })
      };
    }

    console.log('✅ Review submitted successfully:', review.id);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Review submitted successfully!',
        review: {
          id: review.id,
          rating: review.rating,
          purchase_verified: review.purchase_verified,
          created_at: review.created_at
        }
      })
    };

  } catch (error) {
    console.error('❌ Unexpected error in submit-product-review:', error);
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