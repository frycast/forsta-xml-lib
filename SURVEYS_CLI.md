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

## Inspect and test survey behaviour

These commands use the existing offline regression runner. They require Node.js 24 and Python 3.10+. Run `python utils/surveys.py --help` to see all commands.

| Command | Use |
| --- | --- |
| `examples`, `show` | Find a curated example by keyword, question type or API, then read its source and limitations. |
| `inspect`, `extract` | Inspect a question or script, or export the survey structure as JSON. |
| `fixture`, `test` | Export synthetic cases, run them against edited XML, or run the full survey scenario suite. |
| `inventory` | Summarise question structures and repeated scripts across the library. |
| `corpus check` | Verify that the catalogue still matches its pinned XML sources. |
| `corpus lock --revision <commit>` | Maintainers can update the pins after reviewing source changes. |

Pass a path from the default `list` output directly to `inspect`, `extract` or `test`. An existing path in the current working directory takes precedence. When using `list --root`, resolve its output against that custom root. Fixture and report paths are relative to the working directory. With `inspect` or `extract`, use `--json file` to save the report and print just its path and structure/block counts. If an inspection selector matches several items, retry with `--key` and one of the XML keys from the error.

```sh
python utils/surveys.py examples routing
python utils/surveys.py show routing/single-followup
python utils/surveys.py inspect lina_shell/shell-0/3522RL-p624569876868.xml --entity 1652543210
python utils/surveys.py fixture routing/single-followup --json followup.json
python utils/surveys.py test lina_shell/shell-0/3522RL-p624569876868.xml --fixtures followup.json --json -
```

To test an edit, substitute the path to your edited XML in the last command. For regression commands, `--json -` writes JSON to stdout. Exit codes are 0 for success, 1 for a failed test or empty case selection, 2 for invalid input or a tool error, and 4 for stale corpus sources. See the [agent workflow](regression/docs/agent-workflow.md) for fixture design and coverage limits.
