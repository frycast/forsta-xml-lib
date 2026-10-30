# Canonical rehearsal

Read this only for setup verification or a requested rehearsal. Use questionnaire.md and sample-spec.md as task inputs; this file is the coordinator's assessment guide. Workers receive their normal assignments and source-backed checks. Keep generated sessions and evidence outside the installed skill; leave these fixtures unchanged.

## Provision browser workers

Install and authenticate Claude Code, install Node.js/npm, and configure [Playwright MCP and its browser](https://github.com/microsoft/playwright-mcp#readme) before execution. Planning and offline reconciliation do not need browsers. Other hosts/browser tools are outside this package's current contract.

Use Claude Code native workers with a dedicated inline Playwright MCP server/connection per active attempt, launched with `--isolated`. Referring to an already-connected parent MCP server shares that connection. Separate tabs, persistent profiles or a shared CDP connection do not establish independent contexts. Check support in the installed Claude Code version against its [inline subagent MCP documentation](https://code.claude.com/docs/en/sub-agents#scope-mcp-servers-to-a-subagent), inspect the chosen Playwright MCP version's help, and pin the version that passes the trial.

Each worker needs independent observation, navigation, interaction, screenshots and browser closure, plus file read/write access for its assigned absolute attempt path. Give each invocation a private absolute browser-output directory under its attempt, including tool-generated traces. Keep normal host permission controls enabled and scope grants to the required browser tools and attempt-output writes. Report denials as concrete setup blocks to resolve through supported host configuration.

On Windows, an inline server can use this launcher; replace the version and output-directory placeholders with the selected version and assigned path. Other hosts can use `npx` directly.

```text
command: cmd
args: /c npx -y @playwright/mcp@<selected version> --isolated --headless --browser msedge --output-dir <absolute attempt evidence directory>
```

For automated Claude Code invocation on Windows, use the native executable and pass multiline assignments through stdin; the `.cmd` shim lost prompt/configuration content in an earlier trial. Worker definitions and dispatch follow SKILL.md; keep survey execution behavior in worker.md.

## Run the canonical rehearsal

From the installed skill directory, with Node.js available:

```text
node scripts/rehearsal-server.mjs
```

The server binds only 127.0.0.1:4173, prints its origin and writes no files. Stop with Ctrl+C. An optional numeric port argument changes the port; adjust a local copy of returned-links.csv to match. No npm install is needed for the mock. Playwright MCP and its browser must already be configured separately. Use a new cohort value in the local export for each repeated batch; count=5 requires all five workers to overlap (use count=1 only for a separate single-worker smoke check).

1. Plan from [questionnaire.md](questionnaire.md) and [sample-spec.md](sample-spec.md). A compact solution is: 0001 eligible with H+O and synthetic Other text; 0002 eligible with W; 0003 ineligible; 0004 eligible with N; 0005 repeats 0001. Equivalent answers are acceptable if all checks are accounted for. Check both tiers/locales, exclusivity, zero/one/multiple loops and a Q2 missing-answer/recovery probe. No browser observations arise from planning.
2. Reconcile [returned-links.csv](returned-links.csv) by text Id, preserving leading zeros and matching preloads despite row order. In separate disposable offline copies, introduce duplicate IDs/URLs, an unknown Id, a missing record and a mismatched tier. Verify each affected record stays unallocated, without opening it. Use the clean copy for browser work.
3. Dispatch five attempts concurrently through five private Playwright MCP connections, using the normal reservation/log/report contract. Every /start page displays initial cookie/localStorage values: both must be absent. Click Set private marker in every worker. Wait for all five live markers, then click Check private marker after overlap. Each worker must retain only its own Id in both stores. Keep every page open until it shows `Overlap checks complete: 5/5`, and capture that display before continuing. This second barrier keeps the short ineligible route from closing before slower workers have checked. An observed mismatch fails isolation even if survey checks succeed. Polling proves concurrent activity, not exclusive storage by itself; inspect all five readings/screenshots.
4. Execute the assigned checks and capture terminal evidence. Workers close their private browsers and return report text; the coordinator saves it unchanged into each report.md. Reopen each worker's browser at the same origin's /fresh path: both markers must be absent. Capture that evidence, then close again. Keep logs contemporaneous and verify five separate attempt directories and reports. Stop at the batch checkpoint; no sixth attempt starts automatically.

Complete when the source-backed checks, isolation/closure checks, log timing and returned-report persistence are supported by actual evidence, or concrete gaps are recorded. Record host/MCP/browser versions and setup with the local trial results; repeat capability verification when that setup changes, rather than before every survey invocation.

This small fixture does not establish backend storage, real token consumption, server-side resume or full interruption recovery. Use the separate recovery trial below and real survey inputs for survey-specific validation.

## Verify interruption and recovery separately

Use a harmless fixture that supports saved progress when testing resume; the bundled mock is stateless. Interrupt an attempt after navigation has begun, then restart the coordinator from the session files. Verify the link remains unavailable even if no worker report returned. Release a reservation only with proof that it was never opened. Exercise an explicitly selected, supported same-case resume with a new attempt ID separately from a fresh reproduction.

Record the installed versions, setup, observations and evidence with local trial output outside the installed skill. Configuration inspection and sequential browser success alone do not pass concurrent capability verification. Normal survey invocations do not recreate the development `.validation/` directory.
