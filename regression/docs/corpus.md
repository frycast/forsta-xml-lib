# Corpus v1: scope and evidence

Start with the [agent workflow](agent-workflow.md). This corpus builds on PR #2 at
`cba78916e5eda67c8ec52a389c49fc1e2926304d`; the survey exports are unchanged.
The catalogue and source pins are in `../corpus/`. Use `show <id> --json -` for
exact export/revision, entity IDs, XML paths, hashes, code, dependencies and cases.

## Selection across the library

All 80 exports were parsed. They contain 16,889 server blocks (4,105 distinct exact
code hashes), 4,515 browser blocks, 7,708 conditions, 131 loops, 1,403 calls to
blocks, 649 callable definitions, 969 grids and 75 3D grids. Six server blocks
have syntax incompatible with this runner, near redacted Authenticate code.
These are inventory counts, not tested behaviours. Reproduce with:

```sh
node regression/cli.mjs inventory --json regression-output/inventory.json
```

The inventory includes per-export hashes, node/block counts, incompatible block
locations and the twenty most repeated code hashes with source references. Exact
hash deduplication is conservative: whitespace/comments and real logic changes
both produce a different hash. It does not infer semantic equivalence.

Selection favours distinct requirements and variations over shell frequency:

| Recurring area | Meaningful variation and selection |
| --- | --- |
| Single, Multi, hidden and numeric Open fields | Single-answer autocoding versus multi-answer follow-up; priority categories; numeric lower bounds controlled by another question. |
| Grids | Row-specific validation/clearing, a scale set mask, and Boolean column masks in a Grid3D. Rendering and automatic aggregation are separate. |
| Routing and sections | Nested source structures are inspectable; selected condition/folder branches and ordered callable targets execute. The callable clock follows the target EntityId rather than a copied function. |
| Loops | 80 exports share a contact-history loop family; the corpus instead uses a device-context mask and LULU's masked provider loop. Their data/context differ. Iteration is not claimed. |
| Masks | Boolean question/column masks; direct field sets; union with fixed exclusives; set subtraction; and helper-driven add/remove rules. |
| Validation/DK/refusal | A complete option-subset matrix, cross-question numeric bounds with explicit no-response metadata, and grid clearing. Do not infer a universal DK encoding. |
| Sample/state | Sample URL via GetRespondentValue, queue updates via SetRespondentValue, background-group routing and indexed session fields. |
| Piping | Hidden wording categories, conditional loop-member text, and getDB2Text-dependent numeric-question text. Code/text/dependencies are inspectable; text substitution is unexecuted. |
| Incentives and integration | Standard status eligibility differs from omnibus section eligibility. Service responses are exact queued mocks. Email category behaviour is explicitly questionable. |

## Catalogue

All 19 entries are characterised current behaviour under documented assumptions.
The 322 scenarios cover eight exports: 274 inherited cases plus 48 new cases.
Every scenario belongs to one entry; helpers/structures are shared through source
selection, not copied into the corpus. Extra source shown for context can be
unexecuted, as the limits below make explicit.

| Stable example ID | Main evidence | Important limit |
| --- | --- | --- |
| `routing/advice-category` | Priority calculation and group gating | Resulting piping is not rendered. |
| `routing/single-followup` | Empty/one/multiple selections | No automatic requiredness check. |
| `validation/exclusive-options` | All 128 subsets of seven codes | XML/UI exclusivity is separate. |
| `respondent/session-clock` | Fixed-time path and indexed duration writes | One explicit global-hook call. |
| `respondent/queue` | Status boundaries, sample writes, early completion | No CATI scheduler/database. |
| `integration/email-category` | Exact HTTP request and category outcomes | Suspected includes() defect; not policy advice. |
| `incentive/standard` | Status, dummy exclusion, exact credit attempts | No payment/idempotency guarantee. |
| `incentive/omnibus` | Section-count variation and boundaries | Confirm eligibility policy. |
| `redirect/completion-state` | 4×4 transition table and terminal stops | No persistence or end-block lifecycle. |
| `redirect/sample-link` | Original helper, sample link and SID | Current URL fixture already has a query. |
| `mask/selected-plus-exclusive` | Missing/selected/already-exclusive sets | Predefined lists and UI order are separate. |
| `mask/device-options` | Helper, laptop/tablet and smartphone branches | Explicit single loop context per case. |
| `mask/question` | Boolean mask, missing/selected/unselected codes | Explicit mask execution only. |
| `mask/scale` | Empty/normal/excluded domains and subtraction | Row masks and browser hooks unexecuted. |
| `mask/grid-columns` | Prompt flag/existing-answer combinations | Selected DK column only. |
| `validation/months-worked` | Cross-question bounds, DK/refusal, malformed/missing inputs | Numeric widget and text helper unexecuted. |
| `validation/grid-row-clear` | Valid/invalid/missing cells; ordered clears | Both invalid rows leave only the last message. |
| `routing/callable-clock` | Real call target and fixed timestamp | InOrder callable only. |
| `structure/loop-members` | Loop mask cases plus original member/body/text structure | No loop traversal or caret evaluation. |

Passing scenarios reach 31 distinct server blocks across these eight exports:
3 in `3470CL-p102837425171.xml`, 1 in `3511L-p126373808691.xml`, 5 in `3519L-p177291954851.xml`, 1 in
`3374-p197227522938.xml`, 1 in `shell-1.2/3593AL-p280853323149.xml`, 5 in `9145O2L-p312541195228.xml`, 1 in
`3530BL-p514002831313.xml`, and 14 in `3522RL-p624569876868.xml`. A helper counts once when loaded;
this is **not** coverage of all its functions. The other 72 exports have inventory
inspection only. No export has a complete interview test.

## Supported behaviours and limits

The inherited [mock contract](../README.md#mock-contract) still applies. Additions:

| Surface | Explicit contract |
| --- | --- |
| `set(...)`, `a(id)` | String/number code sets; codes normalise to strings and deduplicate. `a` requires an explicit fixture domain. Unknown/malformed values fail. |
| `union`, `diff` | Return a new set. Field variants use the explicitly declared field value. A null field is an empty set. |
| Set `add`, `remove` | Mutate the receiving set. No universal Forsta collection API is implemented. |
| `mask` step | PrecodeMask/ScalePrecodeMask must return a set or Field. Compare normalised codes in insertion order. This order is not Forsta display/randomisation order. |
| Boolean masks | QuestionMask/ColumnMask use explicit `expression` steps and require Boolean results. Option Expression blocks can be selected by exact XML path. |
| `CallBlock` | Resolve BlockToCallEntityId to one CallableBlock and execute Nodes in order, then return to the caller. Missing targets, recursive calls and non-InOrder targets fail. Stops/redirects remain terminal. |
| XML inspection | Retain original attributes/local configuration, descendant/ancestor paths, raw subtree hashes and caret-containing text. This does not execute configuration. |

Still unsupported: loop traversal and implicit indexed response context,
structured-only predicates, randomised routing, browser/DOM hooks, caret piping
and escaping, XML-enforced numeric limits/requiredness, automatic hook sequencing,
quotas, full interview back/resume, actual services, concurrency and persistence.
Inspecting source or compiling JavaScript must never be reported as testing these.
A route step lists omitted hooks; scripts/masks must be selected explicitly.

## Unresolved questions, not recommended patterns

- **Email categories:** JavaScript `includes` checks only the first search term in
  the exported call. `accept_all` fails, while `role_address`/`disposable` pass.
  Confirm the intended business rule and Forsta runtime before changing it.
- **Missing numeric answers:** in DB2, a null value with null noResponse metadata
  participates in JavaScript numeric coercion. Group 4 passes as if zero; group 1
  fails. Determine how Forsta supplies a missing numeric value and enforces XML
  requiredness. This is a local characterisation, not an endorsement.
- **Multiple grid errors:** both invalid P_INTENTIONS cells clear, while the error
  helper replaces the first message with the second. Confirm desired UX and
  whether the production question can expose the invalid options.
- **Incentives:** standard versus omnibus eligibility differs. No fixture proves
  atomic writes, deduplication or external credit success.
- **Set/date semantics:** insertion ordering, null-as-empty sets and JSON timestamp
  serialization are declared model assumptions. Confirm them in a Forsta test
  survey before relying on them for a new use case.
- **Piping/loops:** the source exposes conditional text and per-loop context, but
  no local result proves rendered wording, implicit field binding or loop order.

## Verification and artifact review

Contract tests cover set operations, invalid/missing domains, mask return types,
call resolution/return/nested conditions/stops, source hashes, sample/numeric
attributes and unexecuted piping. CLI tests exercise discovery, JSON export,
external XML paths from a different cwd, deterministic reports, failure codes and
stale/removed sources in a disposable checkout. The worked-change script is also
run in CI.

Twelve selected in-memory mutations are detected: the eight inherited checks plus
removing a mandatory mask option, changing a numeric upper bound, failing to clear
a grid row, and removing the wrong device option. Each original first passes;
mutants must fail an assertion rather than a missing mock. The separate worked
example changes/repairs a temporary XML through the public CLI.

New files contain synthetic fixtures, metadata, hashes, toolkit code and docs.
No survey business logic is copied into the corpus. Added content was reviewed
for credentials and respondent identifiers: fixtures use generic labels, fixed
times, choice codes and missing values; inherited service fixtures use synthetic
addresses and the already-redacted token. No live service was contacted. A manual
review and targeted secret/identifier pattern scan are evidence for these added
artifacts, not a certification of the existing exports. Inspection reports can
contain source text and should be reviewed before sharing.
