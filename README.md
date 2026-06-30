# TalkKing Local Codex Runner

Slack approval-based local runner for ErrorOps Codex tasks.

## Flow

```text
ai-error-analyzer -> Slack [CODEX_TASK] message -> 2 approvals -> local runner -> Codex
```

## Slack Task Message Format

Post a message in the configured Slack channel:

```text
[CODEX_TASK]
id: alert-010a22bf
title: Fix chat-service restart loop
severity: warning

prompt:
우선 app/config/infra를 dev 브랜치 최신으로 pull 해줘.
chat-service 로그와 Kubernetes manifest를 확인하고 필요한 수정을 해줘.
검증 후 새 브랜치로 push해줘.
```

Add the configured approval emoji, default `:white_check_mark:`, from at least two users.
Add `:x:` to reject and block execution.

## Setup

```powershell
cd C:\CE\talkKing\team2-talkKing-codex-runner
Copy-Item .env.example .env
npm install
npm run once
```

By default, `CODEX_EXECUTION_MODE=dry-run`, so approved prompts are written to `prompts/completed` without running Codex.
Set `CODEX_EXECUTION_MODE=execute` only after confirming your local Codex CLI command.

## Required Slack Bot Scopes

Public channel:

```text
channels:history
channels:read
chat:write
files:read
reactions:read
```

Private channel:

```text
groups:history
groups:read
chat:write
files:read
reactions:read
```
