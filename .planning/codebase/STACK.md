# Technology Stack

**Analysis Date:** 2026-01-22

## Languages

**Primary:**
- JavaScript (ES6+ modules) - All application and UI code
- HTML5 - Template-based markup in `src/index.template.html`
- CSS3 - Styled with Tailwind CSS

**Secondary:**
- TypeScript (`.ts`) - Playwright E2E test configurations only
- CommonJS (`.cjs`) - Build scripts and PostCSS configuration

## Runtime

**Environment:**
- Node.js (no specific version pinned in package.json)
- Browser runtime (ES2020+ support required)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- Vite 7.1.7 - Build system and dev server
  - vite-plugin-singlefile 2.3.0 - Bundles entire app into single HTML file
  - Used for development (`npm run dev`) and production builds (`npm run build:agent`)

**Styling:**
- Tailwind CSS 4.1.13 - Utility-first CSS framework
- @tailwindcss/postcss 4.1.13 - Tailwind CSS PostCSS plugin
- PostCSS 8.5.6 - CSS transformation
- autoprefixer 10.4.21 - Vendor prefix injection

**Testing:**
- Vitest 3.2.4 - Unit and component test runner
  - Config: `vitest.config.js`
  - Command: `npm run test` for unit tests
  - Includes jsdom 27.0.0 for DOM simulation

- Playwright 1.55.1 - Browser automation and E2E testing
  - @playwright/test 1.55.1 - Playwright test framework
  - Config: `playwright.config.ts`
  - Command: `npm run test:e2e` for end-to-end tests
  - Headless Chromium by default

**Build/Dev:**
- dependency-cruiser 16.10.4 - Dependency analysis and visualization
  - Used for architecture mapping via `node scripts/docs/export-architecture-map.js`
- simple-git-hooks 2.11.0 - Pre-commit hook runner
  - Configured in `package.json` scripts section
  - Runs `node scripts/test-tools/run-precommit-scaling.js` before commits

## Key Dependencies

**Critical:**
- No external backend frameworks or database libraries
- No npm packages for HTTP clients (fetch API used directly via `fetch()`)
- No validation libraries (custom validation in application code)

**Infrastructure:**
- None - pure client-side single-page application

## Configuration

**Environment:**
- No `.env` files required
- No environment variable dependencies detected
- All configuration embedded in source code

**Build:**
- `vite.config.js` - Vite configuration with plugin settings
- `vitest.config.js` - Vitest unit test configuration
- `playwright.config.ts` - Playwright E2E test configuration
- `tailwind.config.js` - Tailwind CSS content scanning and theme extension
- `postcss.config.cjs` - PostCSS plugins for Tailwind and autoprefixer

**Application Configuration:**
- `src/js/core/config.js` - Feature flags and constants
- `src/js/core/version.js` - Version and APP_VERSION constant
- `src/js/ai/ai-config.js` - AI provider configuration (Anthropic/OpenAI)

## Platform Requirements

**Development:**
- Node.js (version not specified, assumed LTS)
- npm (no specific version required)
- Git (for pre-commit hooks)

**Production:**
- Modern browser with ES2020+ support
- 10+ MB file size limit for downloaded `.quad` files (enforced in parser)
- localStorage support for theme persistence and chart divider positioning

## Build Output

**Process:**
1. Source HTML template copied: `src/index.template.html` → `index.html`
2. Vite builds and bundles: outputs to `dist/index.html`
3. Final copy: `dist/index.html` → `index.html` (deployed version)

**Result:**
- Single-file HTML bundle containing all CSS and JavaScript
- No external dependencies at runtime
- ~1MB+ compressed single-file application

---

*Stack analysis: 2026-01-22*
