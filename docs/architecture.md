# Architecture and compatibility

The package manifest exposes three TypeScript entry points. Each reads the same validated global configuration at load. Pure ESM policies have no host imports and can be unit-tested without Pi. Host dependencies are wildcard peers; tests pin Pi and pi-ai 1.3.0, plus pi-dynamic-workflows 3.14.0 for child integration. Later Pi releases are not claimed compatible without verification, especially the loadout projection hooks.

## Compaction

`session_before_compact` delegates to native `compact()` with the original preparation object. The extension clones only the model's output ceiling and substitutes a bounded stream through the existing model registry. Provider auth stays with Pi. Normal request options are untouched.

An abort controller bounds the whole operation, including both native split-turn calls. Each request receives a timeout and zero retries, with the minimum of its native token allowance and the configured summary ceiling. Generated text is validated before native file metadata or split-turn headings can mask an empty result. A successful native result retains its original cut point, token accounting and file metadata. Original branch user text is appended to the summary without reconstructing it from previous summaries. An over-budget protected section returns to the native path visibly. Generation failures cancel the operation so Pi does not save a partial checkpoint.

Only `openai-completions` compaction is supported in this release. The payload cap uses `max_tokens`; the Qwen template override is an explicit compatibility option. Other APIs use native compaction. Log and tool policies can still target them.

## Logs

The `tool_result` hook selects only recognized routine success/progress rows from direct shell captures whose structured output is explicitly marked complete. Text-only timeout errors are left unchanged. A diagnostic denylist prevents routine classification, and all unrecognized rows, neighbors and edges survive. Original content and structured output are stored under `details.localContextLog`, while both model-visible representations are shortened. This deliberately trades disk storage for less model input; it does not compress session files.

`context_log` scans the current branch's original entries rather than only its compacted model context. It returns bounded numbered lines or literal query matches. There is no filesystem access by this tool; session retention governs recoverability.

## Tool declarations

`context_tools.prepareLoadout` uses native `hiddenDeclarations`. Tools stay registered and active; hiding a schema is not a security boundary. Its reachability declaration enumerates the tools from the selected group. The loader activates only installed, non-hidden tools through Pi's native API. No provider-wide schema rewriting or broad catalog injection occurs.

Loaded groups are stored in a custom branch entry and restored on session start/tree movement. Model changes enable helpers only for opted-in targets and restore ordinary declarations for other models. Group definitions are explicit configuration and can intentionally affect optional third-party tools; base/helper names are rejected during validation.

## Verification loop guard

`loop-guard.ts` is a separate child-safe factory with no provider registration, timer or workflow orchestration. Direct mechanical check failures are keyed by tool arguments and diagnostic fingerprints. Observed source bytes are bounded to 32 files, 256 KiB each and 1 MiB total, confined to the workspace; unreadable or oversized witnesses cannot prove an unchanged failure. Recognized generated report/log paths are excluded. This is a heuristic, not complete dependency tracking or a semantic assessment of progress.

The second matching error persists a branch-local BLOCKED checkpoint. New tools are denied, and the next assistant message is replaced through Pi's supported same-role `message_end` hook before requested tools run. Provider identity and usage remain authentic; the replacement labels itself extension-generated and never claims verification passed. One final provider continuation per prompt may be needed (one-token output ceiling for continuations while blocked on openai-completions); no queue-wait cancellation is promised. Native provider retry/schema-repair attempts retain enforcement. Failure signatures retain all bounded capture context, not only keyword rows; captures over 65,536 characters or explicitly truncated output cannot establish a match. A parallel batch accepted before detection can finish. `turn_end` is a second stopping boundary.

Native workflow children must explicitly allowlist this extension. Their terminal checkpoint reaches the real workflow collector; structured workflows fail schema compliance rather than fabricating a passing value. Arbitrary workflow JavaScript is not globally paused by this extension. The parent guard preserves and annotates workflow results and gates subsequent coordinator tool calls. Factory state is isolated per session. `/context-guard` and `context_guard` report progress; only `/context-guard reset` or an observed source change reopen a blocked phase. Ordinary input cannot safely reset it because SDK repair prompts also identify themselves as interactive input.

## Verification boundaries

Unit tests cover policy failures and conservation. SDK tests cover actual extension loading, agent tool execution, schema projection, native shell tail formatting and native compaction serialization. Model responses are synthetic in the portable suite; the earlier model measurements are documented separately. This release does not claim a multi-hour real-world stability benchmark or universal server/template support.
