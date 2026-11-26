---
name: redact-secrets
description: Redact secrets from a file or directory using Betterleaks. This is not PII detection; emails and other personal information are assumed acceptable. Use only when explicitly invoked by the user.
---

Before running the CLI, verify that all dependencies are available:

1. Check that Bun and Betterleaks 1.9.x are installed and executable:

   ```sh
   bun --version
   betterleaks version
   ```

   If Betterleaks is available only by a known executable path, check its version using that path and pass it with `--betterleaks` below; it does not need to be on PATH. If Bun or Betterleaks is unavailable, stop and tell the user which tool needs installing.

2. Check that all JavaScript dependencies declared in `package.json` are installed:

   ```sh
   npm ls --prefix "<skill-directory>/scripts" --depth=0
   ```

   Resolve `<skill-directory>` to the absolute path of this skill.

   If the command succeeds, proceed without installing anything. If it fails, stop and instruct the user to run:

   ```sh
   bun install --cwd "<skill-directory>/scripts" --frozen-lockfile
   ```

For zipped Forsta exports in this repository, use a batch directory with the selected ZIPs at its top level and no existing `xml` subdirectory. From the repository root, run the extractor in PowerShell, substituting the batch directory as needed.

```powershell
.\utils\extract-export-xml.ps1 -ExportsPath .\surveys\new
```

The extractor processes ZIPs in name order, requires exactly one XML member per archive, and writes each to `xml/<archive-stem>.xml`. After successful extraction, use the resulting folder (here `surveys/new/xml`) as the input path below.

Run the bundled CLI, resolving the script relative to this skill:

```sh
bun <skill-directory>/scripts/redact-secrets.ts "<user-provided-path>"
```

If Betterleaks is not on PATH, use:

```sh
bun <skill-directory>/scripts/redact-secrets.ts --betterleaks "<betterleaks-executable>" "<user-provided-path>"
```

Access sensitive files only through the ZIP extractor and redaction CLI. Do not read, search, preview, upload or otherwise inspect their contents, including for troubleshooting or verification. Report the CLI's summary. Do not claim that detection guarantees removal of all secrets.

