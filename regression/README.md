# Offline Forsta XML regression tests

Run selected survey scripts against explicit synthetic respondent fixtures. Check
field writes, service-call attempts, validation, routing decisions and stop nodes
without a Forsta account, database, browser, API key or production connection.

The runner reads the **current XML files in `surveys/`**. It does not maintain
copies of the business logic or change the exports. This is a regression toolkit
for selected behaviours, not a complete Forsta interview engine.

## Run it

Requirements: Node.js 24 and Python 3.10 or later. There are no npm or pip
dependencies, and no install step. Run these commands from the repository root:

```sh
npm test
node regression/cli.mjs test --json regression-output/results.json --junit regression-output/results.xml
node regression/cli.mjs test --case sample-only/scode
node regression/cli.mjs inventory --json regression-output/inventory.json
node regression/cli.mjs extract surveys/p624569876868.xml --json regression-output/lulu-extracted.json
```

On Windows, if the Python command is `python`, first run
`$env:PYTHON = "python"` in PowerShell. On other systems, `PYTHON` can also specify
an absolute interpreter path. Validation for this initial version ran on Linux,
Node 24.22.1 and Python 3.12.14.

`npm test` runs both toolkit tests and survey scenarios. The CLI returns a nonzero
exit code for any failed case, invalid XML, invalid fixture or empty selection.
Reports go to an ignored directory. No report contains a wall-clock timestamp or
run duration, so repeated runs with the same input produce identical report data.

## Small architecture

| File | Responsibility |
| --- | --- |
| `extract.py` | Parse XML with Python's standard Expat parser; retain decoded source, XML paths, entity IDs, names, opening-tag lines and SHA-256 hashes. Reject DTDs and external entities. |
| `runtime.js` | Define the small Forsta mock model inside a fresh JavaScript realm. |
| `runner.mjs`, `worker.mjs` | Run each case in its own process, evaluate selected blocks, walk explicit routing slices, assert outcomes, and calculate coverage. |
| `cli.mjs` | Run scenarios, extract exports, inventory the repository, and emit JSON/JUnit reports. |
| `scenarios/` | Synthetic fixtures and reviewable expected outcomes for three real surveys. |
| `test/` | Test the harness and prove selected regressions are detected using in-memory mutations. |

The source is evaluated unchanged by Node's JavaScript engine. It is not
transpiled from JScript.NET or repaired after redaction. Expressions use JavaScript
completion values, which permits a trailing semicolon; routing expressions must
return a boolean. Invalid or unsupported selected code fails the case.

Each process receives only the scenario and extracted survey data. It does not
inherit the parent environment or credentials. The realm has no `require`,
`process`, `fetch`, `XMLHttpRequest`, timers or DOM. All HTTP methods below are
strict queued mocks. A script cannot silently fall through to a real HTTP client.
Execution is bounded to 150 ms per evaluation, 3 seconds per case, a 128 MiB V8
heap, 1,000 route visits and 10,000 trace events. These are failure limits, not
performance assertions.

The Node VM and worker process are **not a security boundary for hostile code**.
Use this with reviewed repository exports and trusted scenario modules. For
untrusted inputs, also use an OS/container sandbox with network egress disabled.
The ordinary fixture runs need no network and have no production integration.

## Add a scenario

Add an `.mjs` file to `regression/scenarios/`, exporting an array. Or supply a
separate directory with `--suite path/to/scenarios`. Scenario modules are trusted
test code; they must not make network calls or use time/randomness to build cases.

```js
export default [{
  id: 'lulu/example-autocode-single-answer',
  survey: 'surveys/p624569876868.xml',
  given: { fields: { A10: ['2'], A11: null } },
  steps: [{ route: { entity: '1652543210' } }],
  expect: {
    fields: { A11: '2' },
    writes: [['A11', '2']],
    visited: ['1652543210', '1652543209'],
  },
}];
```

1. Extract the XML and find the exact block or routing node. Select by
   `{entity, kind}`; use `{key}` if an entity has multiple expressions. A selector
   must match exactly once. Names are also supported but can be ambiguous.
2. Declare every field/sample value that the script reads **or writes**. `null`
   means explicitly missing; an undeclared field is a fixture error. Use synthetic
   values such as `person@example.invalid` and `fixture-record`.
3. Load dependencies with a preceding `script` step that selects their original
   `ScriptCode`. Do not duplicate helper functions in fixtures.
4. State the expected business result independently of the implementation.
   Include success, failure, boundary and missing-value cases. Small matrices are
   useful for invariants; an expected decision table is useful for status mapping.
5. Run the focused cases, then `npm test`. Inspect `results.json` and the coverage
   report. A block reached once does not establish coverage of every function or
   branch in that block.

Step forms:

```js
{ script: { entity: '1652543248', kind: 'ValidationCode' }, currentForm: 'A26' }
{ expression: { entity: '1652543279', kind: 'Expression' }, equals: true }
{ route: { entity: '1652543210' } }
```

`expect.fields`, `respondent` and `environment` assert selected final values.
`expect.writes` optionally asserts the exact ordered list of `f(...).set(...)`
calls. `expect.effects` always asserts the exact ordered external/state API calls
and defaults to `[]`. Validation defaults to no error and no messages. A stop or
redirect must be explicitly expected through `halt`. `visited` asserts the exact
ordered XML entities entered in a routing slice.

## Mock contract

These rules are explicit modelling assumptions based on the selected scripts;
they are not a claim of platform-wide Forsta API equivalence.

| Surface | Model |
| --- | --- |
| `f(id, ...indices)`, `.item(code)` | Declared scalar/multicode values and indexed cells. Cells use fixture keys such as `session_duration[1]` or `grid[1][row]`. Use ordinary Forsta identifiers without brackets in names/codes. |
| `.get()`, `.set()` | Copy values; unwrap field objects. Single fields store a string code, including a singleton multicode assignment; Multi fields store string arrays. These two types are inferred from XML and can be overridden with `given.types`. Other fields retain JSON scalar/array types. |
| `.any()`, `.none()`, `.all()`, `.size()` | Compare stringified codes; size counts selected values. `null`, `''` and `[]` are missing. |
| `.toBoolean()`, `.toNumber()`, coercion | `toBoolean()` means answered, including numeric zero. Numeric conversion uses JavaScript `Number`. Missing field coercion gives an empty string; arrays stringify with commas. Multi-code numeric coercion fails. Non-finite/undefined writes fail rather than being silently converted to JSON null. |
| `.getNoResponseValue()` | Require an explicit `given.noResponse` entry; no guessed DK/refusal rules. |
| `.domainValues()`, `.categories()`, `.label()`, `.valueLabel()` | Require explicit `domains` / `labels` metadata. No automatic answer-mask, translation or randomisation engine. |
| Respondent/sample fields | `GetRespondentValue` / `SetRespondentValue` use a distinct, declared `given.respondent` store. |
| Context getters | `CurrentForm`, `CurrentLang`, channel, production/RDG mode, status and extended status require corresponding `given.environment` values. |
| `SetStatus`, `SetExtendedStatus`, `SetPanelistCredit` | Record every call and arguments. Status calls update the mock environment. Credit calls do not award money or assume remote idempotency. |
| `Request.QueryString.item()` | Read explicit `given.query` values; use null for absent parameters. |
| `Http.Get/Post/Put/Delete` | Consume `given.http` in order. Each entry requires `method`, exact `args`, and `response` or `error`. Unexpected or unused expectations fail. |
| `RaiseError`, clear/message methods | Record validation state/messages. `RaiseError` does **not** stop the script. `LangIDs` supports `en`, `en_gb`, `en_au`. |
| `Redirect` | Record the attempted URL/arguments and terminate the scenario. This is an explicit model assumption. |
| Time/randomness | Fixed UTC clock (default 2026-01-01), configurable `now`, deterministic LCG with configurable `seed` (default 1). Locale date formatting and `Intl` are unsupported. |

An unknown API, missing metadata, unsupported field method or missing global
function fails. Extend a mock only for a concrete scenario, add a contract test,
and record the assumption here. Do not add a generic no-op fallback.

## Control-flow boundary

A route step starts **at the selected subtree**; it does not infer or check its
ancestors. It handles `Condition` expressions, ordered `TrueNodes` / `FalseNodes`,
`ElseEnabled`, `Folder`, `Page`, `Script`, question visits, `Note` and terminal
`Stop` nodes. If both an expression and a stored structured predicate exist, the
explicit expression is used. Structured-only predicates fail. `Loop`, `CallBlock`,
emails, telephone and other unsupported nodes fail when entered.

Answers are preseeded. Visiting a question does not render it or run its masks,
startup scripts, validation, triggers or global hooks. Extracted question blocks
omitted during a route are listed in `omittedHooks`; structured predicate/trigger
trees and ancestors are outside this model. Select required server hooks in
separate explicit steps. Stop nodes record their type/ITS and terminate traversal;
they do not simulate Forsta's status writes, end-block execution or database commit.

Browser startup code (including attributes) and inline HTML script elements are
extracted but never executed. External script references and text surfaces with
carets are counted, not fetched/evaluated. Rendering, piping, question requiredness,
option exclusivity configured in XML, quotas, full interview navigation, back
buttons, retries/concurrency, services, CATI scheduling and persistence require
additional tests outside this toolkit. Literal script bytes are not an API contract.

## Reports and CI

Failures identify the case, XML file, selector, opening-tag line, step, assertion
diff, and ordered effect/write trace. Runtime errors also carry an extracted-script
stack location where available. JSON includes file and block hashes. JUnit feeds
standard CI test viewers. Replay with `--case <case-id>` (substring matching).

The GitHub workflow runs the toolkit tests, survey scenarios and all-export
inventory with read-only repository permission and no secrets. It retains JSON
and JUnit reports for 14 days, including on failure. Inventory syntax failures are
reported separately; they are not silently treated as executed tests or made
fatal for unrelated scenarios. Any selected incompatible block fails its case.

See [coverage and observed behaviour](docs/coverage.md) for the initial results,
representative selection, and the distinction between regression guarantees and
current behaviour that may need a future business decision.
