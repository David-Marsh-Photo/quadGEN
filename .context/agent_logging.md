# Agent Logging Requirements

## When to Create a Log Entry
- A plan-required task completes
- A bug requires >1 iteration to resolve
- Dependencies or build configs change
- Significant feature implementation

## Log Path Structure
```
./agent-logs/<YYYY-MM-DD>/<HHMM>-<topic>.md
```

## Log Template
```markdown
# Context
1-2 sentences: what was done.

# Changes Made
- Key changes (files modified, features added)

# Commands Run
- Relevant commands only

# Findings
- Results / errors / lessons learned

# Follow-ups
- Next required actions (if any)
```

## Logging Rules
- **Relative paths only** in log content
- **No secrets / tokens / passwords**
- **Keep entries compact** but informative
- **Review today's logs** before starting new work
- **Update existing log** if continuing same task in same session
- **Never delete agent logs** - these are permanent project history, not temporary files

## When to Update Documentation

The following documentation should be updated when completing work that affects:

| Change Type | Update Location |
|-------------|-----------------|
| New file format support | `docs/File_Specs/`, `.context/core.md` |
| Architecture changes | `docs/architecture-map.md` (regenerate) |
| New AI/Lab Tech functions | `.context/ai-integration.md` |
| Major feature implementation | `docs/features/`, `CHANGELOG.md` |
| Build system or dependency changes | `.context/core.md`, `package.json` |
| New context modules | `.context/README.md` |
| New safety rules or patterns | `.context/guardrails.md` |

After updating documentation, add a note in your agent log: "Updated [doc]: [brief description]"
