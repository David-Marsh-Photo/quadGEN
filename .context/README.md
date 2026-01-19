# quadGEN Context Modules

Modular documentation for AI assistants working on quadGEN.

## Loading Patterns

Load modules based on your task:

| Workflow | Load These Modules |
|----------|-------------------|
| **General coding** | `guardrails.md` + `core.md` |
| **Data pipeline work** | `core.md` + `data-pipeline.md` |
| **Testing & debugging** | `core.md` + `testing.md` + `guardrails.md` |
| **AI integration** | `core.md` + `ai-integration.md` |
| **Curve editing** | `core.md` + `data-pipeline.md` + `ai-integration.md` |

## Module Index

| Module | Purpose |
|--------|---------|
| `core.md` | Framework (Vite, ES6), architecture, file formats, project overview |
| `guardrails.md` | Safety rules, working codebase policy, debugging strategy |
| `data-pipeline.md` | PCHIP, LAB lifecycle, linearization, Smart Curves, keypoints |
| `testing.md` | Playwright patterns, smoke tests, E2E, visual diagnosis |
| `ai-integration.md` | Lab Tech functions, tool contracts, documentation policy |
| `agent_logging.md` | When/how to log agent work, log template, documentation updates |

## Domain Knowledge

Reference workflows for understanding the real-world processes quadGEN supports:

| Document | Purpose |
|----------|---------|
| `docs/photogravure-multi-ink-calibration-workflow.md` | Multi-ink channel calibration for direct-to-plate photogravure |

These explain the "why" behind quadGEN features—bell curves for secondary channels, ink limits, density ratios, and linearization.

## Quick Reference

- **Build command:** `npm run build:agent`
- **Smoke test:** `npm run test:smoke`
- **Architecture map:** `docs/architecture-map.md`
- **Assistant persona:** Senior Lab Tech at a fine art print studio

## Critical Rules (Always Apply)

1. Never push to GitHub without explicit user approval
2. Use PCHIP for all smooth curve interpolation (never smoothstep, Catmull-Rom, etc.)
3. Run `npm run build:agent` after modifying any `src/` files
4. Verify fixes through automated testing, not assumptions
