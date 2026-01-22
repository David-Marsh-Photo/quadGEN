# External Integrations

**Analysis Date:** 2026-01-22

## APIs & External Services

**Claude AI Integration:**
- Service: Anthropic Claude API (via Cloudflare Worker proxy)
  - What it's used for: AI assistant for natural language control of quadGEN settings and analysis
  - SDK/Client: Native `fetch()` API to Cloudflare Worker
  - Model: `claude-sonnet-4-5` (primary, configurable)
  - Fallback: `gpt-5-mini` (OpenAI, for provider switching)
  - Location: `src/js/ai/chat-interface.js`, `src/js/ai/ai-config.js`

**Cloudflare Worker API Proxy:**
- Service: https://sparkling-shape-8b5a.marshmonkey.workers.dev
- Purpose: Proxies AI requests to avoid exposing API keys in browser
- Auth: API key passed in request headers to Worker
- Implementation: POST requests with JSON payload containing messages and function definitions

**External Documentation Links:**
- quadgen.ink - Official project homepage
- clayharmonblog.com - Downloadable calibration targets
- easydigitalnegatives.com - EDN target downloads
- Used for help content and reference links only (not API calls)

## Data Storage

**Databases:**
- Not used - pure client-side application

**File Storage:**
- Local filesystem only via browser File API
- File input for loading: `.quad`, `.cube`, `.acv`, `.txt` (LAB), `.ti3` (CGATS)
- File output: Generated `.quad` files downloaded to user's computer

**Caching:**
- None - no server-side or distributed caching
- Browser cache for static assets (implicit via single-file HTML)

**Local Persistence:**
- localStorage for UI state:
  - Theme preference: `theme-key` (light/dark mode)
  - Chart divider height: `chart-divider-height`
  - Panel divider width: `panel-divider-width`
- No IndexedDB or Web Storage APIs beyond localStorage

## Authentication & Identity

**Auth Provider:**
- Custom - API key managed by user in UI
- Implementation: User pastes AI API key into app settings
- Validation: Simple length check (> 10 characters)
- Storage: Session-only, not persisted to localStorage
- Location: `src/js/ai/chat-interface.js` methods: `validateApiKey()`, `setApiKey()`

## Monitoring & Observability

**Error Tracking:**
- None - errors logged to browser console only

**Logs:**
- Console logging only
- Debug flags available:
  - `DEBUG_LOGS` - General console logging
  - `DEBUG_AI` / `DEBUG_SMART` - AI/Smart curve logging
  - `DEBUG_INTENT_TUNING` - Intent tuning details
  - `DEBUG_LAB_BYPASS` - LAB bypass diagnostics
- Location: `src/js/core/version.js`, feature flag system

## CI/CD & Deployment

**Hosting:**
- Static file distribution (single HTML file)
- Deployable to any HTTP server or as local file (file:// protocol)
- Offline-capable: fully functional without network

**CI Pipeline:**
- None detected - no GitHub Actions, GitLab CI, or similar
- Pre-commit hook via simple-git-hooks:
  - Runs: `node scripts/test-tools/run-precommit-scaling.js`
  - Purpose: Smoke/regression testing before commit

## Environment Configuration

**Required env vars:**
- None - application is self-contained

**API Key Configuration:**
- Anthropic API Key: User-provided at runtime via UI settings modal
- Not stored in environment variables
- Not required for basic functionality (AI features disabled without key)

**Secrets location:**
- User's browser session memory only
- Never persisted to localStorage or cookies
- Passed to Cloudflare Worker in request headers

## Webhooks & Callbacks

**Incoming:**
- None - client-only application

**Outgoing:**
- None - no server callbacks from application
- All AI calls are request-response, not event-driven

## File Format Integrations

**Input Formats:**

| Format | Parser | Purpose |
|--------|--------|---------|
| `.quad` | `src/js/data/quad-parser.js` | QuadToneRIP curve definitions |
| `.cube` | `src/js/data/cube-parser.js` | 1D/3D LUT files for linearization |
| `.acv` | Photoshop curves (EDN workflow) | EDN linearization reference |
| `.txt` (LAB) | `src/js/data/lab-parser.js` | ColorMuse/spectrophotometer measurements |
| `.ti3` (CGATS) | `src/js/data/cgats-parser.js` | Argyll CMS measurement data |

**Output Formats:**
- `.quad` - Generated QuadToneRIP files (256 points per channel, text format)
- `.txt` - Manual L* entry logs

**Supported Printer Configurations:**
- 8-channel: K, C, M, Y, LC, LM, LK, LLK (Epson P600/P800)
- 10-channel: K, C, M, Y, LC, LM, LK, LLK, V, MK (Epson P700/P900)
- Generic N-channel support via parsed header

## External Resources

**Documentation URLs:**
- Offline: https://quadgen.ink/index.html (downloadable version)
- Not an API integration - static reference links only

**No Known External Dependencies:**
- No third-party print driver integration
- No color management system (CMS) integration
- No ICC profile loading/validation from external services
- No cloud sync or backup services

---

*Integration audit: 2026-01-22*
