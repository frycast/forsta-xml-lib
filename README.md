# Forsta XML library

Use real Forsta survey exports to find scripting examples, develop survey changes and test selected behaviours offline.

[Browse the survey exports](surveys/). Each filename uses the SRC job ID. Exports with a known shell version sit in a matching folder, such as `surveys/shell-1.2/`. Repeated job IDs include the Forsta project ID to distinguish exports. Where the job ID metadata was unusable, the filename uses the job ID from the project name.

[Follow the agent workflow](regression/docs/agent-workflow.md) to inspect an example, export its synthetic fixtures and test a local XML copy. From the repository root, with Node 24 and Python 3.10 or later, try:

```sh
node regression/cli.mjs examples mask
node regression/cli.mjs test --example mask/device-options
```

The [behaviour catalogue](regression/docs/corpus.md) explains what each example tests and which checks require Forsta.
