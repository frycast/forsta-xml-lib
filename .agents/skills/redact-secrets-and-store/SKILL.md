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

Directory mode processes top-level XML files. Stdout lists stored paths relative to `surveys/`. The redactor writes its summary to stderr and leaves its report and redacted copies in `redact-secrets-output/` beside the input file or inside the input directory. For another run, move that output aside or use a fresh inbox. Identical existing files are accepted. Ambiguous metadata is an error. Detection covers secrets and can miss values.

If a library copy differs, store exits with code 3 and prints JSON containing all conflicting destination paths, the redactor output directory, and a review token. Ask the user once about all listed paths. Offer to keep the existing copies, replace all, choose individually, or leave the batch pending. Wait for an explicit decision before filing. A pending batch needs no running terminal. To show the current review in a later session, use the first command below on the output of a successful redaction run.

```sh
python utils/surveys.py resume "<redact-secrets-output>"
python utils/surveys.py resume "<redact-secrets-output>" --review TOKEN --keep-all
python utils/surveys.py resume "<redact-secrets-output>" --review TOKEN --replace-all
python utils/surveys.py resume "<redact-secrets-output>" --review TOKEN --replace "relative/destination.xml"
```

Use the token from the review the user answered. Repeat --replace for each chosen replacement; the remaining conflicts keep their existing copies. Exit 3 on resume requests a fresh decision. Report other errors without inspecting raw exports. Resuming uses the existing redacted copies.

After a successful import from `surveys/new`, verify that every input was filed, already matched, or was explicitly skipped in favor of the library copy. Then remind the user which batch files remain and offer to delete them. Name the applicable originals (ZIPs or loose XML), extracted XML, redacted working copies, and redaction report. If the user kept any conflicting library copies, identify the skipped incoming versions that cleanup would discard. Keep failed or pending batches available for recovery.

Wait for explicit cleanup approval. Before deleting, verify that each approved path still belongs to the completed batch and resolves inside `surveys/new`. Delete only those files and remove batch-created subdirectories only when empty. Preserve the inbox itself and any unrelated, new, or changed files.

For date queries, only Python 3.10+ is required. Use UTC dates for filters. Paths break timestamp ties in ascending order.

```sh
python utils/surveys.py list --limit 1 --json
python utils/surveys.py list --since 2026-10-01 --before 2026-11-01
```
