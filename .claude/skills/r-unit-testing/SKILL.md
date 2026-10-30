---
name: r-unit-testing
description: Help write and improve unit tests for R code, especially with testthat. Use when adding tests to existing R functions, fixing a bug with a regression test, or checking whether current tests are useful and reliable.
---

# R Unit Testing

Write tests that check what the code should do from the caller's point of view.

## Before writing tests

1. Read the function and any nearby tests.
2. Explain in one or two sentences what behaviour needs testing.
3. Choose a few small, clear examples. Prefer inputs where a person can work out the expected answer by hand.

## Write useful tests

- Use `testthat` unless the project already uses something else.
- Check existing tests first and look for important behaviour that is not covered yet.
- Test behaviour, not internal implementation details.
- Give tests plain names that describe the behaviour being checked.
- Use small fixtures. A few rows are usually better than a large realistic dataset.
- Write expected values independently. Do not calculate the expected result using the same logic as the function under test.
- Cover the normal case first, then important edge cases such as `NA`, empty inputs, unexpected categories, and errors when relevant.
- For data frames, check the important values and structure: rows, columns, names, types, or ordering where those are part of the contract.
- Avoid mocks unless the code crosses a real external boundary such as an API, database, clock, random generator, or filesystem.
- Keep tests isolated and deterministic: they should not depend on test order, leftover state, current time, randomness, or external services unless those dependencies are deliberately controlled.

## Work in a simple loop

For each behaviour:

1. Write one test.
2. Run it and make sure it can fail for the right reason.
3. Fix or adjust the code if needed.
4. Run the tests again.
5. Move to the next behaviour.

Do not add lots of tests at once before running them.

## Keep the analyst informed

When adding or changing tests, briefly explain:

- what behaviour each test protects;
- why the chosen example is useful; and
- any important behaviour that is still untested.

Keep explanations short and in plain language. 

Ensure the tests themselves are easy to read and understand. Prefer simple setup, clear names, and obvious expected results over clever or compressed test code.