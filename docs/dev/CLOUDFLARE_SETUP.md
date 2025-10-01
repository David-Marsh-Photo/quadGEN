# Cloudflare Worker Setup Instructions for quadGEN

## Prerequisites
- Cloudflare account with Workers enabled
- Worker already created: `sparkling-shape-8b5a`
- CLAUDE_API_KEY environment variable set (for Anthropic)
- Optional: OPENAI_API_KEY environment variable set (for OpenAI)

## Setting Up Rate Limiting with KV Storage

### Step 1: Create KV Namespace
1. Go to Cloudflare Dashboard → Workers & Pages
2. Click on "KV" in the left sidebar
3. Click "Create namespace"
4. Name it: `quadgen_rate_limits`
5. Click "Add"

### Step 2: Bind KV to Worker
1. Go to your worker: `sparkling-shape-8b5a`
2. Click "Settings" tab
3. Scroll to "Bindings" section
4. Click "Add binding"
5. Choose:
   - Type: `KV Namespace`
   - Variable name: `RATE_LIMIT_KV` (must match exactly)
   - KV namespace: `quadgen_rate_limits`
6. Click "Save"

### Step 3: Deploy Updated Worker Code
1. Copy the contents of `cloudflare-worker.js`
2. Go to your worker's "Code" tab
3. Replace existing code with the new code
4. Click "Deploy"

### Switching Providers (Code-Level)
- The app posts a `provider` field to the worker (`anthropic` or `openai`).
- No UI toggle is required; set this in code (see `quadgen.html` constants).
- The worker routes to Anthropic Messages API or OpenAI Chat Completions API accordingly.

## Rate Limits Implemented

The worker now enforces these limits per IP address:
- **10 requests per minute** - Prevents rapid-fire abuse
- **100 requests per hour** - Standard usage cap
- **500 requests per day** - Daily maximum

### How It Works
- Tracks requests by IP address (CF-Connecting-IP header)
- Stores request timestamps in KV storage
- Automatically cleans up old data after 25 hours
- Returns 429 status code when limits exceeded
- Includes rate limit headers in responses:
  - `X-RateLimit-Limit`: Current limit
  - `X-RateLimit-Remaining`: Requests remaining
  - `X-RateLimit-Reset`: When limit resets
  - `Retry-After`: Seconds until next request allowed

### Testing Rate Limits
1. Make 11 requests within 1 minute → Should get rate limited
2. Check response headers for rate limit info
3. Wait 60 seconds → Should work again

### Monitoring
- View KV storage data in Cloudflare dashboard
- Check worker logs for rate limit violations
- Monitor worker analytics for 429 responses

## Fallback Behavior
If KV namespace is not configured:
- Worker will still function
- Rate limiting will be disabled
- Warning logged: "RATE_LIMIT_KV not configured"

## Security Notes
- Rate limits are per IP address
- Users behind same NAT/proxy share limits
- VPN users can bypass by changing IP
- Consider adding API key authentication for production use
 - Do not hardcode API keys; use Worker environment variables `CLAUDE_API_KEY` and `OPENAI_API_KEY`.
