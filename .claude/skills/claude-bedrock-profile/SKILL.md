---
name: claude-bedrock-profile
description: Set up switchable Claude Code profiles (Amazon Bedrock vs first-party Anthropic API) using per-profile settings files and PowerShell launcher functions. Use when the user wants to switch between Bedrock and Anthropic, says Bedrock env vars or model IDs are leaking between sessions, or asks to move Bedrock settings out of shell env vars or settings.json, or asks to start using claude with Bedrock.
---

# Claude Code profile switcher (Bedrock / Anthropic)

Creates one settings file per provider under `~/.claude/profiles/` and launcher functions (`cc-bedrock`, `cc-anthropic`) that run `claude --settings <profile>`. The `--settings` file layers over user settings, so its `env` and `model` take precedence.

## Rules

- Confirm with the user (AskUserQuestion) at every numbered step before changing anything. Never batch confirmations.
- Never write secrets (API keys, access keys, tokens) into any file. Credentials come from the shell environment or an AWS profile.
- Back up any file before modifying it.
- Inspect first, change second. Redact values whose names contain KEY, TOKEN or SECRET when displaying them.

## Steps

### 1. Inspect current state (read-only)

Report to the user, then continue:
- `~/.claude/settings.json`: any `env` block, `model`, and `ANTHROPIC_*` / `CLAUDE_CODE_USE_BEDROCK` / `AWS_*` entries.
- Process, User and Machine env vars matching `BEDROCK|AWS_|ANTHROPIC`.
- The PowerShell profile (`$PROFILE`) contents and whether it exists.
- `~/.aws/config` profile names (names only).
- Whether `~/.claude/profiles/` already exists.

### 2. Confirm which profiles to create

Ask which to set up: **both Bedrock and Anthropic (recommended)**, Bedrock only, or Anthropic only.

### 3. Bedrock region and models

Skip if no Bedrock profile.

Ask for the region and model set. Offer these defaults and let the user confirm or edit:

| Setting | Default (AU) |
|---|---|
| `AWS_REGION` | `ap-southeast-2` |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | `au.anthropic.claude-opus-5-5` |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | `au.anthropic.claude-sonnet-5-5` |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | `au.anthropic.claude-haiku-5-5` |
| `ANTHROPIC_SMALL_FAST_MODEL` | `au.anthropic.claude-haiku-5-5` |
| `model` (profile default) | `au.anthropic.claude-sonnet-5-5` |

If the user is not in Australia or the IDs may be stale, offer other regional prefixes (`us.`, `eu.`, `apac.`) and suggest they verify IDs with `aws bedrock list-inference-profiles --region <region>` before confirming.

### 4. Bedrock authentication

Skip if no Bedrock profile.

Ask which method:
- **Bedrock API key via shell env var (recommended for simplicity):** the user sets `AWS_BEARER_TOKEN_BEDROCK` in their shell before launching. Nothing is written to the profile.
- **AWS profile / IAM (SSO or access keys in `~/.aws`):** add `"AWS_PROFILE": "<name>"` to the profile. List the names found in step 1 and ask which to use. Mention `awsAuthRefresh` for SSO if relevant.
- **Other / already handled elsewhere:** write nothing auth-related.

### 5. Anthropic profile default model

Skip if no Anthropic profile.

Confirm the default model (suggest `claude-sonnet-5-5`, or whatever the current session model is). The profile sets `CLAUDE_CODE_USE_BEDROCK` to `"0"` and `model` only.

### 6. Clean up the base settings and environment

Explain that leftover Bedrock values in base `settings.json` or shell env vars leak into the other profile. Offer, each as a separate confirmation:
- Remove `env` and `model` from `~/.claude/settings.json` (backup to `settings.json.bak` first). Leave unrelated keys (`statusLine`, `modelSettings`, `tui`, etc.) untouched.
- List any User/Machine-level env vars from step 1 that should be removed, and let the user remove them. Do not delete env vars yourself without explicit approval per variable.

### 7. Write the files

Show the final contents of each file and get one last confirmation, then write:

`~/.claude/profiles/bedrock.json`
```json
{
  "env": {
    "CLAUDE_CODE_USE_BEDROCK": "1",
    "AWS_REGION": "<region>",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "<id>",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "<id>",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "<id>",
    "ANTHROPIC_SMALL_FAST_MODEL": "<id>"
  },
  "model": "<id>"
}
```
Add `"AWS_PROFILE"` to `env` only if chosen in step 4.

`~/.claude/profiles/anthropic.json`
```json
{
  "env": { "CLAUDE_CODE_USE_BEDROCK": "0" },
  "model": "<model>"
}
```

Append to `$PROFILE` (confirm permission from user, then create it if missing; skip functions that already exist):
```powershell
function cc-bedrock {
    if (-not $env:AWS_BEARER_TOKEN_BEDROCK) {
        Write-Warning "AWS_BEARER_TOKEN_BEDROCK is not set."
        Write-Host "Set the token, then relaunch cc-bedrock:"
        Write-Host '  $env:AWS_BEARER_TOKEN_BEDROCK = "<your-token>"' -ForegroundColor Cyan
        return
    }

    claude --settings "$HOME\.claude\profiles\bedrock.json" @args
}

function cc-anthropic {
    claude --settings "$HOME\.claude\profiles\anthropic.json" @args
}
```

On non-Windows shells, offer the equivalent bash/zsh aliases or functions in the user's rc file instead.

### 8. Summarise

Tell the user:
- Which files were created or changed, and where the backups are.
- Open a new terminal, then use `cc-bedrock` or `cc-anthropic`.
- For API-key auth, set `AWS_BEARER_TOKEN_BEDROCK` first.
- The provider can't be switched mid-session. Restart with the other command and use `claude --resume` to continue.
- `/model` writes to user settings, so avoid saving a default there while on a profile; set `model` in the profile file instead.
- Suggest verifying with a quick prompt in each profile, since the setup has not been run.
