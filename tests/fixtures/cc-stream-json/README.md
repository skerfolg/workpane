# Claude Code `stream-json` Slice 0 Fixtures

These fixtures were assembled for M1c Slice 0 from **real Claude Code transcripts** in the local environment.

## Files

- `assistant-success.jsonl`
  - Source: live PromptManager run on `2026-04-22`
  - Claude version: `2.1.117`
  - Prompt shape: `Reply with exactly ACK`
  - Coverage: queue + assistant success + result

- `error-rate-limit.jsonl`
  - Source: live PromptManager run on `2026-04-22`
  - Claude version: `2.1.117`
  - Prompt shape: `Use Bash ... report the first three entries only`
  - Coverage: queue + assistant error + result
  - Note: this is the blocker that prevented same-session live tool-use capture before `18:00 +09:00`

- `error-authentication.jsonl`
  - Source: live PromptManager run on `2026-04-22`
  - Claude version: `2.1.117`
  - Prompt shape: bare-mode `Reply with exactly ACK`
  - Coverage: authentication failure path
  - Note: `--bare` drops the auth bridge in this environment, so it is not representative for the default app path

- `tool-use-edit.jsonl`
  - Source: historical PromptManager transcript on `2026-04-01`
  - Claude version: `2.1.87`
  - Coverage: assistant `tool_use` + user `tool_result`
  - Reason included: current live tool-use capture is blocked by rate limiting, but this is still a real PromptManager transcript and preserves the relevant event family and nesting shape

## Format

Each line uses the fixture replay shape approved in the plan:

```json
{"timestamp":"<iso>","channel":"stdout","payload":"<raw-json-event-string>"}
```

`payload` is stored as a single JSON string so the replay harness can feed it into `pty.onData` as a raw chunk.
