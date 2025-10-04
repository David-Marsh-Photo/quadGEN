# quadGEN

quadGEN is a browser-based tool for building and refining QuadToneRIP `.quad` curves. It supports LAB measurement imports, LUT/ACV conversions, and a Smart Edit Mode that mirrors a darkroom workflow. The project now ships as a modular ES-module application with a single-file production bundle for offline use.

Repository: https://github.com/David-Marsh-Photo/quadGEN

## Features
- Import `.quad`, LAB/CGATS/CTI3, Manual L*, LUT (`.cube` 1D/3D), and Photoshop `.acv` data.
- Smart Edit Mode with undo/redo, key-point labels, recompute tolerances, and Lab Tech automation hooks.
- Built-in contrast intents (Linear, Soft, Hard, Filmic, Gamma) with Apply-to-Loaded curve support.
- Help popup with ReadMe, Glossary, Detailed Workflow, and Version History.
- Automated smoke and Playwright parity tests covering the modular UI.

## Quick Start
```bash
npm install
npm run dev        # copies src/index.template.html to index.html and launches Vite dev server
npm run build:agent  # builds production bundle and writes dist/index.html + root index.html
npm run test:smoke   # headless Playwright smoke test (ensures bundle loads without console errors)
# push to GitHub     # see Publishing below for credentials/script setup
```

The production bundle lives at `dist/index.html` and is copied to the project root for single-file distribution.

### Publishing

- Ensure `githubtoken.md` contains your GitHub username on line 1 and a personal access token on line 2 (no trailing spaces).
- After running the smoke test, push updates with `bash scripts/push-with-token.sh`. The script handles authenticated pushes to `main`.
- The script force-pushes; confirm the local state is ready before invoking it.

## Documentation
Key references live under `docs/`:
- `docs/README.md` — documentation index.
- `docs/quadgen_user_guide.md` — user-facing guide.
- `docs/quadgen_workflow.md` — step-by-step calibration workflow.
- `docs/architecture-map.md` — auto-generated module dependency map (`node scripts/docs/export-architecture-map.js`).
- `docs/manual_tests.md` — regression checklist.
- `docs/File_Specs/` — format summaries for `.quad`, `.cube`, `.acv`, LAB `.txt`, CGATS/CTI3.

Developer notes live in `docs/dev/` (build instructions, AI integration, data types, Cloudflare worker setup).

## Testing
- `npm run test:smoke` — Playwright smoke test opening the built bundle.
- `npm run test:e2e` — full Playwright suite (parity/regressions).
- `npm run test` — Vitest unit tests when available.

Scripts under `scripts/test-tools/` provide parity runners and helper tooling.

## Project Structure
- `src/` — ES modules (core state, UI components, data parsers, utilities).
- `scripts/` — build/test/docs tooling.
- `docs/` — user and developer references.
- `archives/` — legacy single-file builds and logs.
- `artifacts/` — screenshots and captured test assets.

## License
See [LICENSE](LICENSE). quadGEN bundles include MIT license text inside the Help ReadMe.

## Maintainers
- David Marsh (marshmonkey@gmail.com)

Contributions welcome — please open an issue or pull request for discussion.
