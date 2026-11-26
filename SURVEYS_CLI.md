# Survey CLI

Run these commands from the repository root with Python 3.10 or later.

## Find surveys by creation date

List the newest export and its `ProjectInfo/@CreatedDate` timestamp. Date searches use only the Python standard library.

```sh
python utils/surveys.py list --limit 1 --json
```

List all exports created during October 2026, newest first. `--since` includes the specified UTC day. `--before` excludes it.

```sh
python utils/surveys.py list --since 2026-10-01 --before 2026-11-01
```

## Redact and store exports

Pass a single XML file or a directory of exports. Imports require Bun and Betterleaks 1.9.x. See the [redact-secrets-and-store skill](.agents/skills/redact-secrets-and-store/SKILL.md) for dependency checks, output paths and retries.

```sh
python utils/surveys.py store "/path/to/inbox"
```
