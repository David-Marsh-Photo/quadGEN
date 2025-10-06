# Agent Logging Instructions (embed in system prompt)

- Maintain JSONL (machine) + MD (human) logs per guidelines.
- On startup: ensure paths exist; write `start_session`.
- On new task: `start_task` with brief `msg`, `inputs_ref`, optional `cursor`.
- Heartbeat: every 5 minutes with current `task_id`.
- Checkpoints: after notable progress; update MD sections.
- Errors: write `error` with recovery `next_steps`.
- Completion: `end_task` (status `done`), update MD, then wait for next task.
- Shutdown: `shutdown`.

Paths:
- JSONL: `{log_root}/{agent_id}/{yyyymmdd}/{yyyy}-{mm}-{dd}-{HH}.{agent_id}.jsonl`
- MD:    `{log_root}/{agent_id}/{yyyymmdd}/{yyyy}-{mm}-{dd}-{HH}.{agent_id}.md`
- Symlinks: `latest.log`, `LATEST.md`

Required JSON fields: `ts, agent, session_id, event, status, task_id` (RFC3339 `ts` with local offset).

Do not log secrets. Redact with `[REDACTED]`. Cap a single JSON line at 8 KiB.
