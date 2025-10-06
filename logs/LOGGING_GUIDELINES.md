# Multi‑Agent Logging Guidelines (quadGEN)

## Scope
Define uniform logging for AI agents to enable deterministic recovery after interruptions.

## Directory Layout
- Root: `~/Dropbox/Alt Photography/quadGEN/logs/`
- Per-agent: `logs/{agent_id}/{yyyymmdd}/`
- Symlinks: `logs/{agent_id}/latest.log` and `logs/{agent_id}/LATEST.md`

## Filenames (Hourly Rotation, local time America/Los_Angeles)
- JSONL: `{yyyy}-{mm}-{dd}-{HH}.{agent_id}.jsonl`
- Markdown summary: `{yyyy}-{mm}-{dd}-{HH}.{agent_id}.md`

## When to Log
Hybrid policy:
1) Event-based: `start_session, start_task, checkpoint, artifact_saved, end_task, error, handoff, shutdown`
2) Heartbeat: every 5 minutes while active: `heartbeat`

## JSON Lines Schema (machine-readable)
Required fields: `ts, agent, session_id, event, status, task_id`
Recommended: `msg, inputs_ref[], outputs[], cursor{file,line}, next_steps[], context{}, metrics{}`

Status: `running|waiting|done|error|skipped`

## Example JSON Object
{ "ts":"2025-10-04T15:02:10-07:00","agent":"codex","session_id":"2025-10-04T15.codex","task_id":"logging-standardization-001","event":"start_task","status":"running","msg":"Create logging guidelines","inputs_ref":["docs/LINEARIZATION_DOMAIN_MAPPING_BUG.md"],"cursor":{"file":"docs/LOGGING_GUIDELINES.md","line":1},"next_steps":["write schema.json","produce agent prompt"] }

## Markdown Summary (human-readable)
Sections:
- `# {agent_id} — {session_id}`
- `## Active task`
- `## What changed` (bullets; newest first)
- `## Next steps`
- `## Artifacts`
- `## Blockers` (optional)

## Atomicity & Concurrency
- Append one JSON object per line in a single write operation.
- Use temp-file then rename for MD updates.
- Prefer per-agent files (no shared writers).

## Retention
- Keep JSONL 30 days, MD 7 days; then compress or delete.

## Recovery Protocol
1) Read tail of `latest.log` for last `checkpoint` or `start_task`.
2) If last event is `error`, propose a recovery and write `start_task` with plan.
3) Update `LATEST.md` with current `Active task`, `What changed`, and `Next steps`.
