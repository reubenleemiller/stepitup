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

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Initialize Supabase client
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    // Get query parameters
    const { 
      product_id, 
      limit = 10, 
      offset = 0,
      sort = 'recent' // 'recent', 'rating_high', 'rating_low', 'helpful'
    } = event.queryStringParameters || {};

    if (!product_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'product_id is required' })
      };
    }

    console.log('📝 Fetching reviews for product:', product_id);

    // Build query with sorting
    let query = supabase
      .from('product_reviews')
      .select('*')
      .eq('product_id', product_id)
      .eq('is_approved', true)
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    // Apply sorting
    switch (sort) {
      case 'rating_high':
        query = query.order('rating', { ascending: false }).order('created_at', { ascending: false });
        break;
      case 'rating_low':
        query = query.order('rating', { ascending: true }).order('created_at', { ascending: false });
        break;
      case 'helpful':
        query = query.order('helpful_votes', { ascending: false }).order('created_at', { ascending: false });
        break;
      default: // 'recent'
        query = query.order('created_at', { ascending: false });
    }

    const { data: reviews, error } = await query;

    if (error) {
      console.error('❌ Error fetching reviews:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to fetch reviews' })
      };
    }

    // Get review statistics
    const { data: stats, error: statsError } = await supabase
      .from('product_reviews')
      .select('rating')
      .eq('product_id', product_id)
      .eq('is_approved', true);

    let reviewStats = {
      total_reviews: 0,
      average_rating: 0,
      rating_distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    };

    if (stats && !statsError) {
      reviewStats.total_reviews = stats.length;
      
      if (stats.length > 0) {
        // Calculate average rating
        const totalRating = stats.reduce((sum, review) => sum + review.rating, 0);
        reviewStats.average_rating = (totalRating / stats.length).toFixed(1);

        // Calculate rating distribution
        stats.forEach(review => {
          reviewStats.rating_distribution[review.rating]++;
        });
      }
    }

    console.log(`✅ Found ${reviews?.length || 0} reviews for product ${product_id}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        reviews: reviews || [],
        stats: reviewStats,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          has_more: (reviews?.length || 0) === parseInt(limit)
        }
      })
    };

  } catch (error) {
    console.error('❌ Unexpected error in get-reviews:', error);
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