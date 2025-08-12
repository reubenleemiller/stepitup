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

    // Get product_id from query parameters
    const { product_id } = event.queryStringParameters || {};

    if (!product_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'product_id is required' })
      };
    }

    console.log('🔍 Fetching previews for product:', product_id);

    // Fetch previews for the product
    const { data: previews, error } = await supabase
      .from('paid_resource_previews')
      .select('*')
      .eq('product_id', product_id)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Error fetching previews:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to fetch previews' })
      };
    }

    console.log(`✅ Found ${previews?.length || 0} previews for product ${product_id}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        previews: previews || [],
        count: previews?.length || 0
      })
    };

  } catch (error) {
    console.error('❌ Unexpected error in get-previews:', error);
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