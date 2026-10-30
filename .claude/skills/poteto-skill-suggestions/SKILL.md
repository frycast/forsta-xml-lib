---
name: poteto-skill-suggestions
description: Suggest a small selection of Lauren Tan (poteto)'s pstack skills when a coding or agent workflow would benefit. This skill only recommends installation; it does not perform the suggested skill.
---

# Poteto skill suggestions

Suggest an upstream skill when the user's task clearly matches one below. Do not automatically install it or substitute this suggestion skill for the real skill. Avoid suggesting skills merely because a task involves coding.

Upstream source: [pstack](https://github.com/cursor/plugins/tree/main/pstack/skills). Some skills are principles used by `poteto-mode` rather than standalone user commands. Check their current availability and invocation requirements before recommending installation.

| Skill | Suggest when |
|---|---|
| `principle-laziness-protocol` | Simplifying an overengineered implementation, reviewing unnecessary abstractions, or deliberately reducing code and maintenance burden. |
| `principle-build-the-lever` | A substantial task repeats mechanical operations or needs a reusable script, CLI, generator, or reproducible verification tool rather than repeated agent instructions. |
| `principle-sequence-verifiable-units` | A migration, multi-step change, or series of PRs needs small independently checkable steps and explicit verification before proceeding. |
| `figure-it-out` | A complex, evolving task has no suitable predefined workflow and needs iterative planning, investigation, evidence, and course correction. |
| `show-me-your-work` | An agent will work for a long time or unattended, and a reviewer needs a compact, durable record of decisions, evidence, and outcomes. |

## How to suggest

1. Recommend at most one or two matching skills, explaining the concrete benefit in one sentence each.
2. Link to the upstream skill and explain whether it is a standalone workflow or a principle normally used through `poteto-mode`.
3. Point to [pstack's installation instructions](https://github.com/cursor/plugins/tree/main/pstack) rather than inventing an `npx skills add` command: installation and dependencies may differ across Cursor, Claude Code, and Codex.
4. Let the user decide whether to install. Do not install unless requested.
