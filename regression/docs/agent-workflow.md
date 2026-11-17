# Develop and test Forsta surveys locally

Link to this page from the wiki. The toolkit reads original XML and runs selected
server code with synthetic fixtures. It needs Node.js 24 and Python 3.10+, with no
npm/pip packages, credentials or production access. All commands work offline.
On Windows, set `$env:PYTHON = "python"` if that is your Python command.

## Find and assess an example

From the repository root:

```sh
node regression/cli.mjs examples mask --type Multi
node regression/cli.mjs examples --api GetRespondentValue
node regression/cli.mjs show validation/months-worked --json -
node regression/cli.mjs corpus check
node regression/cli.mjs test --example validation/months-worked
```

`examples` searches descriptions, tags and requirements; `--type`, `--api`, and
`--tag` are case-insensitive substring filters combined with AND. IDs are stable.
`show` includes the use, observations, dependencies, limitations, original code,
structures, synthetic fixtures and expected outcomes. It follows helper steps and
callable links. Extra blocks shown for context are **not** claimed as tested.
Treat every entry as a characterisation of a specific export. An observation or
suspected defect is not a recommended rule. Read [the catalogue](corpus.md).

Sources are pinned to a Git revision, whole-export SHA-256, decoded script hashes
and raw XML subtree hashes in `../corpus/sources.lock.json`. Git attributes
preserve export bytes and catalogue line endings across checkouts. Runtime reads the
current files; no source code is copied into fixtures. Any export change makes
its entries stale, even if unrelated to the selected block. Missing/ambiguous
selectors also make the corpus stale. Default and example tests then exit 4.
`show` can still inspect changed code; it flags stale provenance when resolvable.

## Inspect the survey being changed

```sh
node regression/cli.mjs inspect surveys/p197227522938.xml --entity 1652542194
node regression/cli.mjs inspect surveys/p624569876868.xml --entity 1652543274 --json -
node regression/cli.mjs extract surveys/p624569876868.xml --json regression-output/extracted.json
```

Inspection retains numeric/hidden/background attributes, answer configurations,
predefined-list references, routing children, ancestor locations, scripts and text
surfaces containing carets. Use `--entity`, `--name` or exact `--key` to select a
structure or block. Ambiguous selectors fail; use the XML path. Whole-file terminal
inspection is a compact node list; JSON includes code and structures. Compilation
is not API support or behavioural coverage. Static inspection cannot resolve
all dynamic dependencies; explicit fixture execution reports missing values/APIs.

Background variables stay distinguishable by their original XML attributes.
`GetRespondentValue` sample data has a separate fixture store from `f(...)` fields.
Do not assume a variable named in a questionnaire is an asked question.

## Prepare an explicit fixture

Start from a related example, then review every input and expectation:

```sh
node regression/cli.mjs fixture routing/single-followup --json regression-output/followup.json
node regression/cli.mjs test /path/to/local.xml --fixtures regression-output/followup.json --json -
```

Windows absolute paths and paths with spaces are supported (quote paths in your
shell). Paths supplied to the CLI resolve from your current directory, so you can
run the CLI by its absolute path from another checkout. The explicit XML argument
replaces every scenario's `survey`; source IDs must exist in that XML. Local runs
report the tested file's hash and do not compare it to corpus locks.

The portable format is JSON data, with no imports or executable fixture code:

```json
{
  "schemaVersion": 1,
  "scenarios": [{
    "id": "my-survey/followup-one-selection",
    "given": {"fields": {"A10": ["2"], "A11": null}},
    "steps": [{"route": {"entity": "1652543210"}}],
    "expect": {"fields": {"A11": "2"}, "writes": [["A11", "2"]]}
  }]
}
```

Declare every field read **or written**. `null` means explicitly missing, not an
omitted fixture. Add `respondent`, `environment`, `query`, `domains`, `labels` and
`noResponse` only as required. No-response codes are explicit; the runner does not
invent DK/refusal rules. Indexed cells use keys such as `grid[a]` and
`session_duration[1]`. Include boundaries, missing inputs and conflicting answers.
Keep expected outcomes independent of the implementation under test.

Load helpers with a preceding `script` step selecting their original XML block.
Do not redefine the helper in a fixture. Effects and validation messages are exact
and ordered, and default to none. Every HTTP call must match a queued synthetic
`given.http` response or error; unused responses fail. Never add real credentials.

| Step | Purpose |
| --- | --- |
| `{"script":{"entity":"id","kind":"ValidationCode"},"currentForm":"Q"}` | Execute an explicit server hook. |
| `{"expression":{"entity":"id","kind":"QuestionMask"},"equals":true}` | Assert a Boolean condition/question/column mask. |
| `{"mask":{"entity":"id","kind":"PrecodeMask"},"equals":["1","99"]}` | Assert a code-set mask; also supports ScalePrecodeMask. |
| `{"route":{"entity":"id"}}` | Traverse an explicitly selected routing subtree. |

See the [mock contract](../README.md#mock-contract) for the inherited model and
[corpus limits](corpus.md#supported-behaviours-and-limits) for additions.
`--suite directory` retains PR #2's trusted `.mjs` scenario-module interface;
JSON fixtures use `test <xml> --fixtures <json>`. Do not run untrusted scenario
modules. Node VM/process isolation is not an OS security boundary for hostile XML
scripts; use an isolated environment for untrusted source.

## Read results

```sh
node regression/cli.mjs test --example mask/device-options --json regression-output/result.json --junit regression-output/result.xml
npm test
```

`--json -` prints only JSON. `--json file` also prints a terminal summary.
Reports are deterministic for the same inputs and paths. A failed scenario includes
its ID, file/hash, block/XML path/line, step/selector, expected and actual result,
error code and ordered trace. Successful results include reached blocks, Boolean
decisions, mask code sets, visited nodes and omitted hooks. Reachability is not
line/branch coverage; loading a helper does not test every function in it.

| Exit | Meaning | Agent action |
| ---: | --- | --- |
| 0 | Command or selected tests succeeded | Review limitations and omitted hooks before claiming coverage. An empty search is allowed. |
| 1 | A test failed, or no cases were selected | Inspect `failure.code`, source and trace. Replay with `--case`. |
| 2 | Invalid CLI/JSON/XML input or tool/setup error | Fix the input or interpreter setup. Errors are JSON under `--json -`. |
| 4 | Corpus source/catalogue is stale | Review source changes before updating pins. No corpus cases were executed. |

`MISSING_FIXTURE` means a required value is undeclared; add an explicit value only
when the scenario justifies it. `UNSUPPORTED` means a platform feature/API is not
modelled. `MOCK_CONTRACT` includes unexpected HTTP calls and invalid set values.
`ASSERTION_FAILED` gives the expected/actual comparison; `WORKER_ERROR` reports
an isolated-process failure; `EXECUTION_ERROR` covers
other script failures. Harness assertion messages also diagnose invalid selectors
and fixture shapes. No unsupported path is silently counted as a pass.

## Worked change in a temporary copy

This executable exercise changes a real follow-up routing threshold from `> 1`
to `> 0`. The existing one-answer fixture must catch that regression. It then
restores the temporary copy and proves the tests pass again:

```sh
node regression/examples/change-and-test.mjs
```

The script discovers the example, exports its fixtures through the CLI, creates a
temporary XML outside the repository, runs a passing baseline, changes just the
selected encoded expression, and runs the same CLI tests. It checks that the
failure is a behavioural assertion, then repairs the copy and reruns. It hashes
the original before/after, leaves it unchanged and removes temporary files. This
is a proposed-change check, not an approved change to the original business rule.

For an **intended** rule change, first write the new expected boundary outcomes,
confirm those tests fail the old source, edit the temporary XML, and require them
to pass. Obtain agreement on the rule before changing production. Do not rewrite
an expectation merely to match an unexpected result.

## Add an example or extend support

1. Find a distinct behaviour/variation; `inventory --json file` shows all exports,
   node kinds and repeated server hashes. Avoid adding another copy of shell code.
2. Add an entry to `../corpus/catalogue.json`. Give it a stable `area/name` ID,
   source selectors, scenario prefixes, purpose, dependencies, observations and
   limits. Keep fixtures in `../corpus/fixtures.json` with descriptive stable IDs.
3. Include original helper blocks as fixture steps. Synthetic data only. Review
   new artifacts for identifying values and credentials; references and hashes
   are preferable to copied source. Generated inspection/test reports can contain
   original text and fixture values: review before sharing them.
4. When a concrete example needs a mock or route node, specify its assumptions in
   the contract, implement the smallest behaviour and add a contract test. Unknown
   APIs must still fail. Add a mutation that changes a meaningful outcome and
   prove the original passes before checking that the mutant fails an assertion.
5. Review source/fixture changes and bump the corpus version when its contract
   changes. Refresh the lock explicitly with the reviewed source commit:
   `node regression/cli.mjs corpus lock --revision <40-character-commit-sha>`.
   Relocking records evidence; it does not validate business rules. Never relock
   automatically in CI or to suppress an unexplained failure.
6. Run `npm test`, `corpus check`, and a focused external-file test. Keep exports
   unchanged unless a separate survey change has been authorised.

## Hand off to Forsta

Use Forsta to confirm question requiredness, XML-configured exclusivity/numeric
limits, piping and escaping, randomisation, loop cell scope, browser hooks, actual
hook order, back/resume, stop/status persistence and service behaviour. Do not
claim these passed because selected server scripts passed offline.

Provide the survey revision/hash and entity IDs, synthetic inputs, intended rule,
local command/result, and the exact unresolved platform assumption. In a test
survey, repeat the boundary/failure path with synthetic sample data, record the
observed route/messages/state, and compare it to the fixture. Keep incentives and
integrations on an approved test setup. Record confirmation (or disagreement) in
the example before broadening claims about support.
