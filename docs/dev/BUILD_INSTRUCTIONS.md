# quadGEN Build Instructions

This document explains how to use the new modular build system for quadGEN development and deployment.

## Overview

quadGEN now uses a modern build system that allows modular development while maintaining the single-file output for GitHub Pages hosting. The build system uses Vite with custom configuration to create a self-contained HTML file.

## Prerequisites

- Node.js (v22+) and npm
- All dependencies installed via `npm install`

## Development Workflow

### 1. Development Server (Hot-Reload)
```bash
npm run dev
```
- Starts development server at `http://localhost:3000`
- Automatically reloads when you edit files in `src/`
- Great for development and testing changes
- Press `Ctrl+C` to stop the server

### 2. Production Build
```bash
npm run build
```
- Creates optimized single HTML file at `dist/index.html`
- Minifies CSS and JavaScript for smaller file size
- Inlines all code into one self-contained file
- Output is ready for deployment to GitHub Pages

#### Automated rebuild for agents
```bash
npm run build:agent
```
- Runs the production build and copies `dist/index.html` to the project root
- Use this after changing files in `src/` so `index.html` matches the latest bundle
- After the build, run the smoke check to confirm the bundle loads without console errors:
  ```bash
  npm run test:smoke
  ```
  The smoke test opens `index.html` in Playwright and fails if any console errors fire during load.
- You can extend this script with lint or additional tests before `vite build` if you want a stricter gate before shipping

### 3. Preview Built File
```bash
npm run preview
```
- Serves the built `dist/index.html` locally
- Test the production build before deployment
- Useful for final verification

## File Structure

### Source Files (Edit These)
```
src/
├── js/
│   ├── core/
│   │   └── version.js         # App version and configuration
│   ├── data/                  # File parsers (future)
│   ├── math/                  # PCHIP, interpolation (future)
│   ├── ui/                    # Chart, controls (future)
│   ├── ai/                    # Smart Curves, Lab Tech (future)
│   └── utils/                 # Helper functions (future)
├── styles/
│   └── main.css               # Custom CSS styles (single source of truth)
├── main.js                    # Entry point and app initialization
```

### Output Files
- `dist/index.html` - Built production file (89.95 kB, 19.31 kB gzipped)
- `index.template.html` - Style-free development shell that loads `src/main.js`

## GitHub Deployment Workflow

### Full Deployment Process
1. **Make changes** in the `src/` directory
2. **Test in development:**
   ```bash
   npm run dev
   ```
3. **Build for production:**
   ```bash
   npm run build
   ```
4. **Copy built file to root:**
   ```bash
   cp dist/index.html .
   ```
5. **Commit and deploy:**
   ```bash
   git add index.html
   git commit -m "🔨 Update quadGEN build"
   git push origin main
   ```

### Quick Build & Deploy Script
```bash
# Build and deploy in one go
npm run build && cp dist/index.html . && git add index.html && git commit -m "🔨 Update quadGEN build" && git push
```

> **Template note:** The build scripts automatically copy `index.template.html` to `index.html` before invoking Vite. Treat `index.html` as generated output—edit the template and source files in `src/` instead.

## Build System Details

### What the Build Does
- ✅ Bundles all JavaScript modules into a single script
- ✅ Inlines all CSS from `src/styles/main.css`
- ✅ Minifies and optimizes all code
- ✅ Preserves Tailwind CSS via CDN link
- ✅ Creates single self-contained HTML file
- ✅ Maintains all original functionality

### Build Output Structure
```html
<!doctype html>
<html>
<head>
  <!-- Tailwind CSS CDN (loads dynamically) -->
  <script src="https://cdn.tailwindcss.com"></script>

  <!-- Build system inlined JavaScript (minified) -->
  <script type="module" crossorigin>/* App code */</script>

  <!-- Build system inlined CSS (minified) -->
  <style rel="stylesheet" crossorigin>/* Custom styles */</style>
</head>
<body>
  <!-- App content -->
</body>
</html>
```

### CSS Authoring
- Edit styles exclusively in `src/styles/main.css` (light/dark tokens, components, overrides).
- Vite inlines that file into the bundled `dist/index.html`; no other CSS sources are consulted.
- `index.template.html` intentionally contains no `<style>` blocks—keep it markup-only so the bundle always reflects `main.css`.
- Layout width is now controlled by the `.main-container` helper in `main.css`; we no longer rely on Tailwind’s `max-w-*` utilities for the app shell.

## Configuration Files

### `vite.config.js`
- Configures Vite build tool
- Uses `vite-plugin-singlefile` for single HTML output
- Sets up development server on port 3000

### `package.json`
Scripts available:
- `npm run dev` - Development server
- `npm run build` - Production build
- `npm run preview` - Preview built file
- `npm run test` - Run test suite

### Build Dependencies
- `vite` - Build tool and development server
- `vite-plugin-singlefile` - Creates single HTML output
- `tailwindcss` + `postcss` + `autoprefixer` - CSS processing

## Troubleshooting

### Common Issues

**Build fails with "unexpected character" errors:**
- These are warnings about escaped quotes in HTML content
- Build still succeeds and creates working output
- Warnings can be safely ignored

**Development server won't start:**
- Check that port 3000 is available
- Kill any existing dev servers with `Ctrl+C`
- Try `npm install` to ensure dependencies are installed

**Built file doesn't work:**
- Verify `dist/index.html` was copied to root correctly
- Check that Tailwind CSS CDN is accessible
- Test with `npm run preview` first

### File Sizes
- Original `quadgen.html`: ~1MB (21,773 lines)
- Built `index.html`: 89.95 kB (19.31 kB gzipped)
- Size reduction achieved through minification

## Browser Testing with Shell Playwright

### Installation
```bash
npm install --save-dev playwright
npx playwright install chromium
```

### Testing Approach
- **Primary Method**: Shell Playwright via Node.js scripts (clean ~200 byte responses)
- **Secondary Method**: MCP browser tools (limited to screenshots and console only)
- **Benefits**: Full Playwright API access without 38k+ token response limits

### Basic Test Pattern
```javascript
// test-example.js
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(`file://${__dirname}/index.html`);
  await page.waitForTimeout(1000);

  const result = await page.evaluate(() => ({
    title: document.title,
    ready: !!document.getElementById('editModeToggleBtn')
  }));

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
```

### Usage
```bash
node test-example.js
```

### Test Examples
- **Edit Mode**: Toggle states and CSS class validation
- **Channel Operations**: State changes and UI updates
- **Theme System**: Light/dark mode switching
- **File Operations**: Load/save workflows

## Future Development

The build system provides foundation for:
- ✅ **Modular development** (easier maintenance)
- ✅ **Hot-reload development server** (faster iteration)
- ✅ **Automated testing** (test individual modules)
- ✅ **Browser testing** (shell Playwright integration)
- ✅ **Code organization** (logical file structure)
- ⏳ **Gradual modularization** (extract remaining 19K lines of JS)
- ⏳ **Centralized state management** (Phase 2 of roadmap)
- ⏳ **Expanded test suite** (Phase 3 of roadmap)

## Support

For build system issues:
- Check this documentation first
- Verify Node.js and npm versions
- Ensure all dependencies are installed (`npm install`)
- Test with a fresh `npm run build`

The build system preserves all original quadGEN functionality while enabling modern development practices.
