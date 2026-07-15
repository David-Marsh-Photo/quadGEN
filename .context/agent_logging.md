# Agent Logging

Agent logs are curated engineering records, not transcripts or a requirement for every planned task.

## Create or Update a Log When

- a significant shipped feature or behavior change needs durable rationale
- a difficult bug required several iterations and produced reusable findings
- dependencies, build configuration, file formats, or architecture boundaries changed

Do not create a log merely because a task had a plan, a test was repaired, or a minor edit completed. Continue the same-session log rather than creating another file.

## Location

```text
./agent-logs/<YYYY-MM-DD>/<HHMM>-<topic>.md
```

## Contents

- context: one or two sentences
- decisions and material changes
- relevant commands and verified outcomes
- durable findings and required follow-ups

Keep entries under roughly 50 lines unless the subject genuinely requires more. Never include secrets, raw transcripts, full test output, screenshots, or generated comparison dumps.

## Retention

- Preserve concise logs that explain shipped behavior or architecture.
- Raw diagnostics and comparison output are temporary artifacts and should be ignored or archived outside the repository after durable findings are extracted.
- Do not delete or relocate existing user material without approval.

## Documentation Routing

| Change | Durable location |
|---|---|
| File format | `docs/File_Specs/` or `.context/core.md` |
| Architecture boundary | `docs/architecture-map.md` |
| Lab Tech contract | `.context/ai-integration.md` |
| Major feature behavior | `docs/features/` and, when released, `CHANGELOG.md` |
| Build or dependency | `.context/core.md` and `package.json` |
| Safety rule | `.context/guardrails.md` |

Update only the documentation whose durable contract actually changed.
