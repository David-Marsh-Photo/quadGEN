# External Playwright Runner Workflow

Direct Playwright runs (for example `node tests/playwright-global-revert.cjs`) now work from Codex when you request `with_escalated_permissions`. The watcher workflow below remains available as a fallback when escalated commands are disallowed or you need unattended reruns.

## Critical Playwright Testing Rules
1. **Inspect before interact**: ALWAYS create a diagnostic script FIRST to examine the actual DOM structure before attempting to interact with elements
   - Check what elements exist, their visibility, their actual structure
   - Don't assume elements are accessible just because they exist in the HTML
   - Example: Check if inputs are invisible/disabled by default
   - Use the Bash tool to run simple diagnostic scripts yourself - don't ask the user
2. **Wait for initialization properly**: Use `page.waitForFunction()` to wait for app-specific readiness conditions, not arbitrary timeouts
   - Wait for specific elements to exist AND be in the expected state
   - Check for app-specific markers (e.g., `_virtualCheckbox`, fully rendered rows)
3. **Match the user workflow**: Interact with UI exactly as a user would
   - Use checkboxes, buttons, file pickers - not direct DOM manipulation
   - Dispatch events the way the app expects them
   - Respect the app's virtual/proxy patterns (e.g., `_virtualCheckbox`)
4. **One working test beats many broken ones**: If a test fails, FIX IT before trying variations
   - Understand WHY it failed by examining the DOM with a diagnostic script
   - Don't create 10 similar tests hoping one will work
5. **Better error messages**: When elements aren't found, log what WAS found to help diagnose
6. **Know when to escalate**: After 2-3 failed test attempts, provide clear manual test instructions rather than asking the user to debug your scripts
   - Only escalate to manual testing when automated testing is genuinely blocked (e.g., needs real file picker interaction)
   - Don't ask user to run diagnostic scripts - run them yourself with the Bash tool
7. **User's time is precious**: Automated tests should save time, not waste it. Every request for manual testing should be justified

## When to use this flow
- `approval_policy=never` or escalated commands are rejected
- You need a long-lived watcher to rerun tests automatically
- Local Playwright installs are unavailable on the host machine

## One‑time setup (outside the sandbox)
1. Install dependencies and Playwright browsers:
   ```bash
   npm install
   npx playwright install chromium
   ```
2. Start the watcher in a long‑running terminal:
   ```bash
   node runner/watch-runner.mjs
   ```
   The script prints `watch-runner is running` once it is ready. Leave this process running; it listens for triggers written to `runner/trigger.json` and executes `npm run test:e2e` (which runs `node run-playwright-test.js`).

## Triggering tests from Codex
From the Codex CLI (or any other process writing in the repo), drop a timestamp into the trigger file:
```bash
node -e "require('fs').writeFileSync('runner/trigger.json', JSON.stringify({ ts: Date.now() }))"
```
Optionally pass additional arguments or environment overrides to `run-playwright-test.js`:
```bash
node -e "require('fs').writeFileSync('runner/trigger.json', JSON.stringify({
  ts: Date.now(),
  args: ['tests/custom-playwright-script.cjs'],
  env: { DEBUG_LOGS: 'true' }
}))"
```
The watcher merges the `env` block into `process.env` for the Playwright run, so you can toggle debugging flags on a per-test basis.

For a one-command workflow, use the helper script that writes the trigger and waits for completion:
```bash
node runner/trigger-and-wait.mjs --follow
```
Pass additional arguments with `--arg=value` (repeatable) or append `--` followed by raw Playwright arguments. Use `--env=KEY=VALUE` to set environment variables for the run, and `--timeout/--interval` to tweak the wait parameters.

## Inspecting results
The watcher writes results into `runner/results/`:
- `status.json` — start/finish timestamps, exit code, and the args/env used for the run.
- `last-run.txt` — full stdout/stderr captured from the Playwright run (includes browser console logs emitted in the test script).
- `artifacts/` — screenshots and other attachments saved by the test helpers.

Example Codex commands to read the results:
```bash
node -e "console.log(require('fs').readFileSync('runner/results/status.json', 'utf8'))"
node -e "console.log(require('fs').readFileSync('runner/results/last-run.txt', 'utf8'))"
```

### Waiting for completion automatically
Instead of sleeping for an arbitrary number of seconds, Codex can now poll the status file until the run finishes:
```bash
node runner/wait-for-status.mjs --follow
```
The helper exits with the test’s exit code (default timeout 180 000 ms). Adjust the timeout or poll interval if needed:
```bash
node runner/wait-for-status.mjs --timeout=240000 --interval=500 --quiet
```
`--follow` streams `runner/results/last-run.txt` while the run is in flight.

## Default script
`scripts/test-tools/run-playwright-test.js` defaults to `tests/playwright-edit-mode-seeding.cjs`. That script launches the app, toggles Edit Mode, loads `Color-Muse-Data.txt`, and asserts that Smart key points are reseeded from measurement data. On failure it saves a full-page screenshot under `runner/results/artifacts/`. Override the script via the trigger `args` field if you need different coverage.

## Notes
- Prefer direct `node tests/...` runs with `with_escalated_permissions` whenever approvals allow; use the watcher only for the cases above
- The watcher executes tests in the environment in which it is launched. Run it outside Codex’s sandbox so browsers can start normally.
- `npm run test:e2e` is the entry point. Update this script if you add a higher-level Playwright test harness.
- The watcher throttles triggers: if one run is in progress while another timestamp arrives, it queues a single follow-up run when the current job finishes.
