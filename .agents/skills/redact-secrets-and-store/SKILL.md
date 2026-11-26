---
name: redact-secrets-and-store
description: Use when asked to redact and file Forsta XML exports in this survey library. Also explains how to find stored surveys by project creation date.
---

Run the CLI from the repository root. Use `python utils/surveys.py --help` or a subcommand's `--help` for its interface.

For an import, keep incoming UTF-8 exports in a separate inbox. Follow the dependency checks in the sibling [redact-secrets skill](../redact-secrets/SKILL.md). For loose XML, pass the original path directly to the wrapper. It runs that skill's redactor first and reads metadata only from the resulting copies.

```sh
python utils/surveys.py store "/path/to/export.xml"
python utils/surveys.py store "/path/to/inbox"
```

For zipped exports, place the selected ZIPs at the top level of a batch directory with no existing `xml` subdirectory. Run the extractor from the repository root in PowerShell, substituting the batch directory as needed.

```powershell
.\utils\extract-export-xml.ps1 -ExportsPath .\surveys\new
```

The extractor processes ZIPs in name order, requires one XML member per archive, and writes each unredacted file to `xml/<archive-stem>.xml`. After extraction succeeds, pass that directory to the storage wrapper.

```sh
python utils/surveys.py store surveys/new/xml
```

Directory mode processes top-level XML files. Stdout lists stored paths relative to `surveys/`. The redactor writes its summary to stderr and leaves its report and redacted copies in `redact-secrets-output/` beside the input file or inside the input directory. For another run, move that output aside or use a fresh inbox. Identical existing files are accepted. Conflicting contents or ambiguous metadata produce an error. Report the error without inspecting raw exports. Detection covers secrets and can miss values.

For date queries, only Python 3.10+ is required. Use UTC dates for filters. Paths break timestamp ties in ascending order.

```sh
python utils/surveys.py list --limit 1 --json
python utils/surveys.py list --since 2026-10-01 --before 2026-11-01
```
