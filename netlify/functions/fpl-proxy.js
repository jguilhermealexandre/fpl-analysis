// In-memory cache with 24-hour TTL
const cache = {
  data: {},
  timestamps: {}
};

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

exports.handler = async function(event, context) {
  // Get the URL from query parameters
  const url = event.queryStringParameters.url;
  
  if (!url) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing url parameter' })
    };
  }

  try {
    // Check if we have cached data that's still fresh
    const now = Date.now();
    const cacheKey = url;
    const cachedData = cache.data[cacheKey];
    const cacheTimestamp = cache.timestamps[cacheKey];
    
    // Return cached data if it exists and is less than 24 hours old
    if (cachedData && cacheTimestamp && (now - cacheTimestamp < CACHE_DURATION)) {
      console.log(`✅ Serving cached data for: ${url}`);
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=86400', // Tell browsers to cache for 24h too
          'X-Cache': 'HIT'
        },
        body: JSON.stringify(cachedData)
      };
    }
    
    // Cache miss or expired - fetch fresh data
    console.log(`🔄 Fetching fresh data for: ${url}`);
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`FPL API returned ${response.status}`);
    }
    
    const data = await response.json();
    
    // Store in cache
    cache.data[cacheKey] = data;
    cache.timestamps[cacheKey] = now;
    
    // Return with CORS headers
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=86400',
        'X-Cache': 'MISS'
      },
      body: JSON.stringify(data)
    };
  } catch (error) {
    console.error('❌ Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: error.message })
    };
  }
};

