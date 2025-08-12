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
    const products = await db.getActiveProducts();
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(products),
    };
  } catch (err) {
    console.error('Error fetching products:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: "Failed to fetch products",
        details: err.message 
      }),
    };
  }
};