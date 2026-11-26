---
name: redact-secrets-and-store
description: Use when asked to redact and file Forsta XML exports in this survey library. Also explains how to find stored surveys by project creation date.
---

Run the CLI from the repository root. Use `python utils/surveys.py --help` or a subcommand's `--help` for its interface.

For an import, keep incoming UTF-8 exports in a separate inbox. Follow the dependency checks in the sibling [redact-secrets skill](../redact-secrets/SKILL.md). For loose XML, pass the original path directly to the wrapper. For a batch of ZIPs, first follow the sibling skill's ZIP extraction step, then pass the resulting XML folder to the wrapper (for example, `python utils/surveys.py store surveys/new/xml`). It runs that skill's redactor first and reads metadata only from the resulting copies.

```sh
python utils/surveys.py store "/path/to/export.xml"
python utils/surveys.py store "/path/to/inbox"
```

Directory mode processes top-level XML files. Stdout lists stored paths relative to `surveys/`. The redactor writes its summary to stderr and leaves its report and redacted copies in `redact-secrets-output/` beside the input file or inside the input directory. For another run, move that output aside or use a fresh inbox. Identical existing files are accepted. Conflicting contents or ambiguous metadata produce an error. Report the error without inspecting raw exports. Detection covers secrets and can miss values.

For date queries, only Python 3.10+ is required. Use UTC dates for filters. Paths break timestamp ties in ascending order.

```sh
python utils/surveys.py list --limit 1 --json
python utils/surveys.py list --since 2026-10-01 --before 2026-11-01
```
