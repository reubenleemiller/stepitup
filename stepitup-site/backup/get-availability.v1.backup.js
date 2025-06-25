const axios = require('axios');
const { Redis } = require('@upstash/redis');

const API_KEY = process.env.CAL_API_KEY;
const USERNAME = 'rebeccamiller';
const EVENT_TYPE_SLUG = '60min-check';

// Configure Upstash Redis
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const CACHE_TTL_S = 300; // 5 mins

exports.handler = async function(event, context) {
  const today = new Date();
  const defaultStart = today.toISOString().slice(0, 10);
  const defaultEnd = new Date(today.getTime() + 12 * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const start = event.queryStringParameters?.start || defaultStart;
  const end = event.queryStringParameters?.end || defaultEnd;
  const timeZone = event.queryStringParameters?.timeZone || 'America/Edmonton';

  // Cache key based on params
  const cacheKey = `availability|${start}|${end}|${timeZone}`;

  // Check Redis cache
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      // Defensive: always stringify in case cache is polluted
      let bodyString;
      if (typeof cached === 'string') {
        bodyString = cached;
      } else {
        bodyString = JSON.stringify(cached);
      }
      return {
        statusCode: 200,
        body: bodyString,
        headers: {
          'Content-Type': 'application/json',
          'X-Cache': 'HIT'
        }
      };
    }
  } catch (err) {
    // Log but don't block function if Redis fails
    console.error('Redis GET error:', err);
  }

  // Otherwise fetch from Cal.com
  const url = `https://api.cal.com/v1/slots?usernameList=${USERNAME}` +
    `&eventTypeSlug=${EVENT_TYPE_SLUG}` +
    `&startTime=${start}` +
    `&endTime=${end}` +
    `&timeZone=${encodeURIComponent(timeZone)}` +
    `&apiKey=${API_KEY}`;

  try {
    const response = await axios.get(url);
    // Always stringify before caching
    const dataString = JSON.stringify(response.data);
    try {
      await redis.set(cacheKey, dataString, { ex: CACHE_TTL_S });
    } catch (err) {
      // Log but don't block function if Redis fails
      console.error('Redis SET error:', err);
    }
    return {
      statusCode: 200,
      body: dataString,
      headers: {
        'Content-Type': 'application/json',
        'X-Cache': 'MISS'
      }
    };
  } catch (error) {
    return {
      statusCode: error.response?.status || 500,
      body: JSON.stringify({
        message: 'Failed to fetch availability',
        details: error.response?.data || error.message
      }),
      headers: {
        'Content-Type': 'application/json'
      }
    };
  }
};