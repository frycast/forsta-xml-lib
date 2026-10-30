---
name: matt-pocock-skill-suggestions
description: Suggest installing one of Matt Pocock's skills (from mattpocock/skills) when the conversation matches its trigger phrases. Covers grilling/interviewing a plan, domain modeling and ADRs, TDD, handoff docs, retrospectives, turning conversations into specs or tickets, implementing a spec's tickets, asking for re-explanation ("wait-what"), writing PR bodies, and the one-time repo setup these skills need. This skill never performs the work itself; it only recommends installation.
---

# Matt Pocock skill suggestions

None of the skills below are installed in this repo. When a user's request matches one, tell them what it does and how to install it, then stop — do not attempt to perform the skill's job yourself using this file.

Some upstream skills set `disable-model-invocation: true`, meaning once installed they only run when the user explicitly invokes them (e.g. `/handoff`), never automatically. That doesn't change how *this* suggestion skill behaves: still proactively suggest installing them whenever the trigger phrases below come up, so the user knows the `/command` exists.

## Available skills

| Skill | Trigger phrases | When to suggest |
|---|---|---|
| `grilling` | "grill me", "grill this plan/idea/decision", "interview me", "stress-test this" | User wants their plan, decision, or idea interviewed and challenged until there's a shared understanding. |
| `domain-modeling` | "domain model", "domain modeling", mentions of `GLOSSARY.md`, writing/editing an ADR | User is discussing or sharpening codebase terminology, or wants decisions recorded as ADRs. |
| `grill-with-docs` | "grill with docs", "grill-with-docs" | User wants a grilling session whose outcomes (glossary terms, ADRs) are written to the repo as they're settled. Depends on both `grilling` and `domain-modeling`. |
| `tdd` | "TDD", "test-driven", "red-green-refactor", "test-first", wants integration tests | User wants to build a feature or fix a bug test-first, or wants help writing tests worth keeping (seams, anti-patterns). |
| `handoff` | "handoff", "/handoff", "hand this off", wants to summarise the session for another agent, a fresh session, a colleague, or a forked parallel task | User's work needs to "travel" to a different agent/session/person rather than just being summarised in place (that's `/compact`, not this). Manual-only (`disable-model-invocation`). |
| `retro` | "retro", "retrospective", "how can we improve the agent setup/repo for next time" | User wants to review a coding session and get suggested improvements to the agent's environment (navigation, automated checks, coding standards, tool economy). Manual-only. |
| `to-spec` | "to-spec", "write a spec", "turn this into a spec", "publish a spec to the issue tracker" | User wants the current conversation synthesized (no further interview) into a spec and filed in the issue tracker. Manual-only; needs an issue tracker and triage labels (`/setup-matt-pocock-skills`). |
| `to-tickets` | "to-tickets", "break this into tickets", "vertical slices", "tracer-bullet tickets" | User wants a plan, spec, or conversation broken into independently demoable, dependency-ordered tickets. Manual-only; needs an issue tracker. |
| `implement-spec` | "implement-spec", "implement the spec/tickets", "work through the tickets", wants parallel subagent implementation on an integration branch | User has a spec with tickets (from `/to-spec` + `/to-tickets`) and wants them implemented, in dependency order, as a single integration branch. Manual-only; needs an issue tracker. |
| `wait-what` | "wait, what?", "I don't understand", "that didn't land", "can you re-explain that" | The user is confused by the agent's last message and wants it re-pitched in plain language using the project's glossary. Manual-only, deliberately tiny. |
| `pr` | "write the PR body", "PR description", "pull request summary" | User wants a PR body written using a Summary / Evidence (before-after) / Merge Danger (door, blast radius) template. |
| `setup-matt-pocock-skills` | "set up matt pocock skills", "configure the issue tracker for these skills", first-time use of `to-spec`/`to-tickets`/`implement-spec`/`triage` in this repo | Run once per repo before first use of the engineering skills: scaffolds the issue tracker choice (GitHub/GitLab/local markdown), triage label vocabulary, and `GLOSSARY.md`/ADR doc layout. Manual-only. Suggest this *alongside* `to-spec`, `to-tickets`, or `implement-spec` whenever the repo hasn't been configured yet. |

## How to suggest

1. Name the matching skill and give a one-line description of what it does (see table above).
2. Give the install command for that skill only:
   ```powershell
   npx skills add mattpocock/skills --skill <skill-name>
   ```
3. Mention dependencies when relevant:
   - `grill-with-docs` also needs `grilling` and `domain-modeling` installed.
   - `to-spec`, `to-tickets`, and `implement-spec` need an issue tracker configured via `setup-matt-pocock-skills` first — suggest installing and running that one too if the repo doesn't already have `docs/agents/` output from it.
4. Let the user decide whether to install; don't run the command for them unless they ask.
