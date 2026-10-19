# pi-local-context

Conservative context management for local models in [Pi](https://pi.dev): bounded compaction, recoverable shell logs, and optional tool declarations.

Built for Pi **1.3.0**, Node **22.19+**, with no additional runtime dependencies. Experimental: validate it on your workload before relying on long sessions. Not affiliated with the Pi maintainers.

## What it does

- **Bounded compaction:** reuse Pi's native compaction algorithm with a separate summary budget and deadline. Preserve cut points, file tracking and original human text. Normal response limits and context settings stay unchanged.
- **Recoverable logs:** omit long runs of recognized successful build/test rows. Keep diagnostics, unknown lines, neighboring context and exit status. The `context_log` tool retrieves original lines from the session.
- **Optional tool groups:** declare explicitly configured groups when `context_tools` loads them. Groups remain loaded on the current branch. Tool implementations stay registered and Pi's permission checks still apply.

This reduces input and summary work. It does not accelerate model decoding, add server slots, replace durable memory, or eliminate every compaction.

## Install

```sh
pi install git:github.com/mredodos/pi-local-context@v0.1.0
```

Run `/reload` in existing Pi sessions. A pinned tag stays pinned when packages update. Package installation and resource selection follow [Pi's package documentation](https://pi.dev/docs/latest/packages).

**No model is opted in by default.** Create `pi-local-context.json` in your global Pi agent directory: normally `~/.pi/agent/` (on Windows, `%USERPROFILE%\.pi\agent\`). Pi's `PI_CODING_AGENT_DIR` override is respected. This package never reads project-level configuration and never writes your configuration.

For a Qwen-compatible local server using Pi's `openai-completions` adapter:

```json
{
  "targets": [{ "provider": "my-local-provider", "id": "my-qwen-model" }],
  "compaction": {
    "enabled": true,
    "maxTokens": 2048,
    "deadlineMs": 120000,
    "maxProtectedChars": 20000,
    "disableThinking": true
  },
  "logs": { "enabled": true },
  "toolGroups": {}
}
```

Replace `provider` and `id` with the **exact identifiers in your Pi model configuration**; display names and wildcards do not match. Then `/reload`. `disableThinking: true` adds `chat_template_kwargs.enable_thinking=false` only to summary requests; use it only when your server/template supports that option. It defaults to `false`. Summary generation requests Pi's `off` thinking level either way; backend behavior varies.

To use only log reduction, omit `compaction`; it is disabled by default. To use only compaction, set `logs.enabled` to `false`. Invalid JSON/options disable the affected extension at load and show a session-start error.

### Configuration

| Setting | Default | Accepted values |
|---|---|---|
| `targets` | `[]` | Up to 100 exact `{provider, id}` pairs |
| `compaction.enabled` | `false` | Boolean; adapter must be `openai-completions` |
| `compaction.maxTokens` | `2048` | Integer 256–8192, further limited by the model ceiling |
| `compaction.deadlineMs` | `120000` | Integer 1000–300000; total attempt including server waiting |
| `compaction.maxProtectedChars` | `20000` | Integer 1000–50000; original human text budget |
| `compaction.disableThinking` | `false` | Explicit Qwen-compatible template override |
| `logs.enabled` | `true` | Boolean; still requires a target match |
| `toolGroups` | `{}` | Up to 20 named groups, each 1–100 optional tool names |

There is no regex/wildcard targeting. Configuration is read at extension load; use `/reload` after edits. Both features can be selected separately with Pi's package resource filters. Avoid loading another copy of these policies at the same time.

### Optional tool groups

Only configure tools you actually have installed. The package supplies no search or workflow implementation. For example:

```json
{
  "targets": [{ "provider": "my-local-provider", "id": "my-qwen-model" }],
  "toolGroups": {
    "web": ["web_search", "fetch_content"],
    "workflow": ["workflow", "workflow_control"]
  }
}
```

The model calls `context_tools({"group":"web"})` or `{"group":"all"}`. Declarations appear on the next request. Existing memory tools, coding tools and MCP discovery stay as configured unless you explicitly put an optional tool in a group. Core read/write/edit/shell tools, `tool_search` and package helpers cannot be grouped. Group names must start with a lowercase letter and contain only lowercase letters, digits, `_` or `-`; `all` is reserved. Loaded group names survive reload and branch restoration in the session; changed group definitions apply after reload. Other models receive their ordinary declarations.

## Limits and recovery

- Compaction uses the current model; no second model or cloud service is needed. A split turn can require **two** native summary calls, each capped, within the same total deadline. The 450-word instruction is a prompt; token limits are enforced. Human text and native file metadata are added afterwards, so the entire checkpoint can exceed the generated summary's token budget.
- Original human **text** messages are preserved chronologically; images are not duplicated. If their combined size exceeds the protected budget, a warning falls back to ordinary native compaction, which may be slow. Generation failure, empty output, token-limit termination, deadline or user cancellation saves no partial checkpoint; history is preserved. Repeated retries of a failing budget need a configuration/workload change.
- Log selection applies only to direct `bash`/`powershell` build/test/check commands, one text block, structured output explicitly marked complete, 8,000–1,048,576 characters and at least 80 lines. It requires at least 40 removable rows and 25% savings. Unknown text and nested tools are untouched. Complete structured output can recover diagnostics missing from the native visible tail; incomplete captures and text-only timeout errors are left alone.
- Exact originals live in the existing tool-result `details`, excluded from model-facing serialization and native summary input. They still occupy session storage and follow its access/retention. The package does not redact sensitive output or create a separate archive.
- To recover lines, use the result's tool call ID: `context_log({"toolCallId":"...","query":"error"})`. `query` is literal and case-insensitive. `startLine` and `limit` paginate at most 400 lines / 16k characters per call. Recovery is limited to the **current branch** and requires its original session entries to remain available.

Remove with:

```sh
pi remove git:github.com/mredodos/pi-local-context@v0.1.0
```

Then `/reload`. Existing selected logs remain in history with their originals in details; reinstalling re-enables recovery. Removing a package does not rewrite prior session entries.

## Evidence and development

Earlier local synthetic measurements showed **29.5–46.7% less compaction time**, **96.7% fewer input tokens for one repetitive log**, and **43.5% fewer tokens for one optional-schema fixture**. These are individual comparisons, not expected whole-session gains. Server work and end-to-end waiting time differ under queued load. See [benchmark conditions and limitations](docs/benchmarks.md).

```sh
npm ci
npm test
```

Tests use synthetic fixtures and the real Pi loader, native compaction and agent loop; no model download, inference request or API key is needed. The pinned development packages are not bundled with the runtime extensions. No CI workflow or install lifecycle script is included. See [CONTRIBUTING](CONTRIBUTING.md), [architecture](docs/architecture.md) and [CHANGELOG](CHANGELOG.md).

## License

[MIT](LICENSE). Pi's host APIs are supplied by the separately installed Pi package under its own license.
