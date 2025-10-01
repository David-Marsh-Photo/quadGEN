// Cloudflare Worker for quadGEN AI proxy with rate limiting (Anthropic + OpenAI)
// Deploy this to your sparkling-shape-8b5a worker
// 
// SETUP REQUIRED:
// 1. Create a KV namespace in Cloudflare: "quadgen_rate_limits"
// 2. Bind it to this worker with the name "RATE_LIMIT_KV"
// 3. Ensure CLAUDE_API_KEY environment variable is set (for Anthropic)
// 4. Optional: Ensure OPENAI_API_KEY environment variable is set (for OpenAI)

export default {
  async fetch(request, env, ctx) {
    // Rate limiting configuration
    const RATE_LIMITS = {
      perMinute: 10,
      perHour: 100,
      perDay: 500
    };

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    // Only allow POST requests
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { 
        status: 405,
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }

    try {
      // Get client IP for rate limiting
      const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
      
      // Debug: Log KV availability
      console.log('KV Binding Status:', {
        available: !!env.RATE_LIMIT_KV,
        clientIP: clientIP,
        timestamp: new Date().toISOString()
      });
      
      // Check rate limits if KV is available
      if (env.RATE_LIMIT_KV) {
        const rateLimitCheck = await checkRateLimit(env.RATE_LIMIT_KV, clientIP, RATE_LIMITS);
        console.log('Rate limit check:', rateLimitCheck); // Still log even if real-time logs don't work
        
        if (!rateLimitCheck.allowed) {
          return new Response(JSON.stringify({
            error: 'Rate limit exceeded',
            message: rateLimitCheck.message,
            retryAfter: rateLimitCheck.retryAfter
          }), {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'X-RateLimit-Limit': rateLimitCheck.limit,
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': rateLimitCheck.resetTime,
              'Retry-After': rateLimitCheck.retryAfter
            }
          });
        }
        
        // Update request count
        await recordRequest(env.RATE_LIMIT_KV, clientIP);
        
        // Add rate limit headers to response
        var rateLimitHeaders = {
          'X-RateLimit-Limit': String(rateLimitCheck.limit),
          'X-RateLimit-Remaining': String(rateLimitCheck.remaining),
          'X-RateLimit-Reset': String(rateLimitCheck.resetTime),
          'X-Debug-KV': 'enabled' // Debug header to confirm KV is working
        };
      } else {
        console.warn('RATE_LIMIT_KV not configured - rate limiting disabled');
        var rateLimitHeaders = {
          'X-Debug-KV': 'disabled' // Debug header to show KV is NOT working
        };
      }

      // Get request body
      const body = await request.text();
      
      // Validate request has content
      if (!body) {
        return new Response('Request body is required', { 
          status: 400,
          headers: { 'Access-Control-Allow-Origin': '*' }
        });
      }

      // Parse to validate JSON
      let requestData;
      try {
        requestData = JSON.parse(body);
      } catch (e) {
        return new Response('Invalid JSON in request body', { 
          status: 400,
          headers: { 'Access-Control-Allow-Origin': '*' }
        });
      }

      // Determine provider (default Anthropic)
      const provider = (requestData.provider || 'anthropic').toLowerCase();
      // Do not forward provider field to upstream API
      delete requestData.provider;

      let upstreamUrl = '';
      let upstreamHeaders = { 'Content-Type': 'application/json' };

      if (provider === 'openai') {
        if (!env.OPENAI_API_KEY) {
          return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured in Worker env' }), { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
        }
        upstreamUrl = 'https://api.openai.com/v1/chat/completions';
        upstreamHeaders = {
          ...upstreamHeaders,
          'Authorization': `Bearer ${env.OPENAI_API_KEY}`
        };
      } else {
        if (!env.CLAUDE_API_KEY) {
          return new Response(JSON.stringify({ error: 'CLAUDE_API_KEY not configured in Worker env' }), { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } });
        }
        upstreamUrl = 'https://api.anthropic.com/v1/messages';
        upstreamHeaders = {
          ...upstreamHeaders,
          'x-api-key': env.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01'
        };
      }

      // Forward to selected upstream API
      const response = await fetch(upstreamUrl, {
        method: 'POST',
        headers: upstreamHeaders,
        body: JSON.stringify(requestData)
      });

      // Get response body
      const responseBody = await response.text();

      // Log for debugging (visible in Cloudflare dashboard)
      if (!response.ok) {
        console.error(`Upstream API error (${provider}): ${response.status} - ${responseBody}`);
      }

      // Return response with CORS headers and rate limit info
      return new Response(responseBody, {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'X-Model-Provider': provider,
          ...rateLimitHeaders
        }
      });

    } catch (error) {
      // Log error for debugging
      console.error('Worker error:', error);
      
      // Return generic error to client
      return new Response(JSON.stringify({ 
        error: 'Internal proxy error',
        message: 'Failed to process request'
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }
};

/**
 * Check if the client has exceeded rate limits
 */
async function checkRateLimit(kv, clientIP, limits) {
  const now = Date.now();
  const oneMinuteAgo = now - 60 * 1000;
  const oneHourAgo = now - 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  
  // Get stored request times for this IP
  const key = `requests:${clientIP}`;
  const storedData = await kv.get(key, { type: 'json' });
  const requestTimes = storedData || [];
  
  // Filter to only recent requests
  const recentRequests = requestTimes.filter(time => time > oneDayAgo);
  
  // Count requests in each time window
  const requestsLastMinute = recentRequests.filter(time => time > oneMinuteAgo).length;
  const requestsLastHour = recentRequests.filter(time => time > oneHourAgo).length;
  const requestsLastDay = recentRequests.length;
  
  // Check minute limit
  if (requestsLastMinute >= limits.perMinute) {
    return {
      allowed: false,
      message: `Rate limit exceeded: Maximum ${limits.perMinute} requests per minute`,
      limit: limits.perMinute,
      remaining: 0,
      resetTime: oneMinuteAgo + 60 * 1000,
      retryAfter: 60
    };
  }
  
  // Check hour limit
  if (requestsLastHour >= limits.perHour) {
    const oldestInHour = recentRequests
      .filter(time => time > oneHourAgo)
      .sort()[0];
    const resetTime = oldestInHour + 60 * 60 * 1000;
    const retryAfter = Math.ceil((resetTime - now) / 1000);
    
    return {
      allowed: false,
      message: `Rate limit exceeded: Maximum ${limits.perHour} requests per hour`,
      limit: limits.perHour,
      remaining: 0,
      resetTime,
      retryAfter
    };
  }
  
  // Check day limit
  if (requestsLastDay >= limits.perDay) {
    const oldestInDay = recentRequests.sort()[0];
    const resetTime = oldestInDay + 24 * 60 * 60 * 1000;
    const retryAfter = Math.ceil((resetTime - now) / 1000);
    
    return {
      allowed: false,
      message: `Rate limit exceeded: Maximum ${limits.perDay} requests per day`,
      limit: limits.perDay,
      remaining: 0,
      resetTime,
      retryAfter
    };
  }
  
  // Request is allowed
  return {
    allowed: true,
    limit: limits.perHour,
    remaining: limits.perHour - requestsLastHour - 1,
    resetTime: oneHourAgo + 60 * 60 * 1000
  };
}

/**
 * Record a new request for the client IP
 */
async function recordRequest(kv, clientIP) {
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  
  // Get existing request times
  const key = `requests:${clientIP}`;
  const storedData = await kv.get(key, { type: 'json' });
  const requestTimes = storedData || [];
  
  // Add new request time and clean old ones
  const updatedTimes = [...requestTimes.filter(time => time > oneDayAgo), now];
  
  // Store back to KV with 25 hour expiration (1 day + buffer)
  await kv.put(key, JSON.stringify(updatedTimes), {
    expirationTtl: 25 * 60 * 60 // 25 hours in seconds
  });
}
