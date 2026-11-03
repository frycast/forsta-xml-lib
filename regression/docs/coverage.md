# Initial coverage and observed behaviour

Baseline: 3 November 2026, exports from repository commit
`cee32f5f26e7b45fa4b5bef3effab17b0945f710`. The survey XML is unchanged.
All fixtures use synthetic values. No live respondent, Forsta service, email
provider or incentive service was contacted.

## What was studied

The inventory parses all **80 exports**. It finds **21,404 nonempty code blocks**:

| Classification | Blocks | Meaning |
| --- | ---: | --- |
| Server code that compiles in Node | 16,883 | Syntax accepted; not evidence that APIs or business paths were executed. |
| Server code that does not compile in this runner | 6 | All are `Authenticate` scripts, with syntax errors near redacted tokens. The JSON inventory lists exact locations. This does not establish a production fault. |
| Browser code | 4,515 | Startup scripts and inline HTML script elements; extracted but not executed. |

The exports contain shared LinA shell functions, nested true/false branches,
question validation, question/option masks, global validation attributes, indexed
fields and browser hooks. The sample-only and omnibus exports also demonstrate
that similar shell scripts can have different business rules. A single universal
"survey complete" fixture would conceal those differences.

## Behavioural demonstrations

**274 scenarios pass**, across three selected exports:

| Export | Why selected | Cases | Server blocks reached / extracted | XML conditions exercised both ways |
| --- | --- | ---: | ---: | ---: |
| `p624569876868.xml` — 3522RL LULU Recontact | Rich routing, validation, shell and integration logic | 214 | 12 / 189 | 2 |
| `p177291954851.xml` — 3537 Annual Stakeholder, sample only | External redirect and completion-code state transitions | 17 | 5 / 147 | 2 |
| `p312541195228.xml` — 9145O2L Client Omnibus | Incentives based on partial section completion | 43 | 3 / 204 | 0 |

These counts are **block reachability in passing cases**, not line, function,
JavaScript branch, path or full-survey coverage. Loading a shared function script
counts that block as reached even when most of its functions are never called.
The remaining 77 exports have inventory/syntax inspection only. None has an
end-to-end interview test. Browser code has zero execution coverage.

| Area | Assertions |
| --- | --- |
| LULU recontact routing | Group 1 enters the selected advice subtree; group 2 skips it. Two wording variables receive the highest applicable advice category. |
| LULU communication routing | Zero answers leave the autocode empty; one answer copies its code; multiple answers visit the follow-up question instead. Both true and false XML branches are tested. |
| LULU complaint validation | All 128 subsets of codes 1–7: code 1 cannot coexist with codes 4–7. Validation flag and exact message are asserted. Other XML option exclusivity rules are outside this test. |
| LULU global validation | Current question, path, page count, indexed session question and duration update at a fixed UTC instant. |
| LULU queue mapping | 39 status cases, including range boundaries and unmapped statuses, plus the early-complete override; expected respondent writes, queue mirrors and status effects. |
| LULU email check | Exact mocked HTTP call; valid, invalid domain/address/account, accept-all, role/disposable and empty-email cases; real shared error helper. |
| LULU and omnibus incentives | Eligible/ineligible statuses, completed-section counts, dummy/missing dummy flags and null/existing status. Exact credit attempt, amount, label and reference. Configured-disabled additional incentives make no calls. |
| Sample-only completion codes | Full 4 × 4 transition table: missing, complete, screened and unknown codes. Complete is absorbing; screened can become complete. Selected XML Stop type/ITS is checked. |
| Sample-only redirect | Real `GetBaseURL` reads the synthetic sample link. The recorded redirect preserves the stored SID and arguments. No browser navigates. |

The run also passes **23 toolkit/mutation tests**. Eight mutations change only
in-memory extracted code and must be detected: advice priority, validation flag,
routing threshold, completed-code protection, dummy exclusion, omnibus eligibility,
queue outcome and redirect SID. Baseline cases pass before each mutation, and the
mutated cases fail a business assertion. No mutated XML is written.

The toolkit tests additionally cover XML/CDATAs/entities and DTD rejection,
ambiguous selectors, fixture/expectation typos, strict mocks, non-finite writes,
validation continuation, repeated credit attempts, HTTP errors, deterministic
clock/randomness, process isolation/timeouts, unsupported syntax/browser execution,
stop termination, unsupported routing nodes, CLI failures, JSON replay and JUnit.

## Observations preserved, not corrected

### Email categories are not checked as a three-value membership test

In LULU question `EC1` (`1652541995`, `ValidationCode`), the final category check is:

```js
returnvalueCat.includes("accept_all","role_address","disposable")
```

Under the JavaScript semantics used by this runner, `includes` searches only for
the first argument. The second argument is a position, and later arguments are
ignored. The fixtures reproduce an error for `accept_all` and no error for
`role_address` or `disposable`. The latter two are current-behaviour
characterisations, **not an endorsement of the business rule**. Confirm the
intended policy before correcting the survey and changing these expectations.

### Omnibus and standard-shell eligibility differ

The LULU script allows credit attempts for extended status 13 or 32. The omnibus
script allows an attempt for status 13 **or a positive completed-section count**.
For example, the fixture with status 14 and two sections attempts a credit in the
omnibus export. The fixture with status 32 and zero sections does not. These are
observations of this export's code, not claims that the policy is wrong.

### Credit attempts do not prove payment idempotency

The mock records every `SetPanelistCredit` attempt. It deliberately does not dedupe
by record ID or infer a remote transaction guarantee. Repeated calls are visible.
Tests of the real service contract, persistence, interrupted writes, concurrent
requests and reconciliation remain separate work. Likewise, an XML Stop records
the intended endpoint; it does not prove the status was committed to a database.

## Extend coverage next

Choose another important business decision and add a small fixture table. Useful
next targets are remaining screener/termination paths, section-incentive scripts,
research-defender failure handling, and resume/back-navigation behaviour once its
platform contract is known. Add mocks only when such a test needs them.

Do not "fix" a failing regression by adding permissive APIs, ignoring missing
fields or copying a function into a test. Determine whether the change is an
intended business update, a regression, an incomplete fixture or an unsupported
platform feature. Keep the old expectation until that distinction is explicit.

For current hashes, exact block coverage and trace evidence, regenerate:

```sh
node regression/cli.mjs test --json regression-output/results.json --junit regression-output/results.xml
node regression/cli.mjs inventory --json regression-output/inventory.json
```
