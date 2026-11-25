# Forsta XML library

Use real Forsta survey exports to find scripting examples, develop survey changes and test selected behaviours offline.

[Browse the survey exports](surveys/). Each filename uses `<src_job_id>-<forsta_id>.xml`, for example `3522RL-p624569876868.xml`. The Forsta ID comes from `ProjectInfo/@ProjectId` in the export. The `LinA_flag` survey field selects `surveys/lina_shell/` (Y) or `surveys/src_shell/` (N). Within each family, the `shell_version` survey field selects the version folder, for example `lina_shell/shell-1.2/`. Folder `shell-0/` holds exports that lack the version field. Where the job ID metadata was unusable, the filename uses the job ID from the project name.

[Follow the agent workflow](regression/docs/agent-workflow.md) to inspect an example, export its synthetic fixtures and test a local XML copy. From the repository root, with Node 24 and Python 3.10 or later, try:

```sh
node regression/cli.mjs examples mask
node regression/cli.mjs test --example mask/device-options
```

The [behaviour catalogue](regression/docs/corpus.md) explains what each example tests and which checks require Forsta.

Use the survey CLI from the repository root to find exports by `ProjectInfo/@CreatedDate`. It uses Python 3.10+ and the standard library.

```sh
python utils/surveys.py list --limit 1 --json
python utils/surveys.py list --since 2026-10-01 --before 2026-11-01
python utils/surveys.py store "/path/to/inbox"
```

The [redact-secrets-and-store skill](.agents/skills/redact-secrets-and-store/SKILL.md) explains import prerequisites, output paths and retries.
