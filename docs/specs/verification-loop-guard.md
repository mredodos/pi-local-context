# Verification loop guard

## Goal and user stories
US1 (P1): Stop a Pi verification phase after two matching tool failures without observed source progress, and hand a bounded BLOCKED checkpoint to its coordinator.
US2 (P1): Legitimate changes and successful checks continue; cumulative/cache token counts alone never trigger a stop.
US3 (P1): The guard loads explicitly in workflow children and reports last check, last successful check and current failure. It must work without changing the model service or application code.

## Scope and assumptions
Pi1.3.0 and pi-dynamic-workflows3.14.0 are the verified baseline. This is a provider-independent execution guard; it is separate from compaction. Targets remain exact opt-in pairs. Native global guard settings are opt-in and the user's local Qwen target is enabled on installation. Existing compaction/log copies and the single server slot stay intact. No application workflow code, browser profiles, credentials or live application tasks are touched; all execution tests are synthetic.

## Requirements and acceptance
- LG-01: Enable only with loopGuard.enabled and an exact target match. Missing/bad config never broadens scope.
- LG-02: Match direct bash/powershell build/test/check commands and explicitly configured verification tool names. Count real errors (isError/nonzero structured exit code), not alarming prose in successful output. Keep signatures per command across the full observed capture; normalize only obvious volatile timestamps/durations/ANSI. Incomplete or oversized captures cannot prove matching failures.
- LG-03: After the second matching failure with no observed source change, latch BLOCKED and prevent new tool calls in that phase. A parallel batch already accepted by Pi may finish; this is a retry boundary, not cancellation of in-flight work. Same-content writes and recognized generated log/report files do not count as source progress. Observe actual native edit/write changes and bounded hashes of directly referenced scripts/diagnostic source paths. Unobservable external changes remain a documented limitation, with human reset available.
- LG-04: Preserve original results and session history. Persist a bounded, labelled extension-generated checkpoint with last successful check, failed check, diagnostic and reset instructions. Never describe the task as verified/passed. Do not copy complete logs or source into a separate archive.
- LG-05: Deliver a terminal assistant-role BLOCKED checkpoint to workflow's native result collector using Pi's supported message_end replacement. At most one ordinary provider continuation per prompt is needed after detection; native provider retries and schema-repair prompts retain the gate and output cap; even a model that requests further tools must be replaced before tools execute. A tool_call block and turn_end boundary are independent fallback enforcement. This stops the child phase, not the entire arbitrary workflow script's scheduler. Structured-output workflows may surface schema failure instead of a successful structured value; they must never invent passing evidence.
- LG-06: Native read-only status tool and explicit /context-guard reset. Ordinary input never clears the latch: SDK schema-repair prompts can report the same source as human input. A change to witnessed source files can reopen the phase before its next prompt. Annotate parent workflow results containing a guard checkpoint as blocked, preserving original results, and block automatic new workflow launches until explicit reset.
- LG-07: Synthetic unit tests, actual Pi agent loop with a deliberately uncooperative model, reload/tree restore and real WorkflowAgent tests. No inference network or credentials. Run Linux and native Windows checks.
- LG-08: Install only this new child-safe extension, explicitly allowlist its filename in existing workflow settings and preserve all other fields. Verify extension discovery/child loading in isolation before installing; existing Pi processes need /reload. Branch/commit/PR, English docs/changelog and shared status reflect verified behavior and limits.

## Data model and API
Session-local failure records and pending file snapshots; bounded checkpoint under a native custom entry; short status metadata in failed results. Lifecycle restore reconstructs only the current branch. Hooks: tool_call, tool_result, message_end, turn_end, before_agent_start, before_provider_request, session_start/tree/model_select. message_end returns a same-role replacement supported by Pi1.3.0; content explicitly says it was produced by the guard and retains actual usage accounting. No provider registration is needed. The final continuation uses a one-token output cap on openai-completions; normal requests retain their limits.

## Limits and security
The guard recognizes mechanical failures; it cannot judge visual quality or whether every edit fixes a defect. Source observation is conservative and bounded (direct referenced scripts plus diagnostic paths, native edits/writes); unknown external changes require reset. It does not interrupt a currently running command or already accepted parallel batch, or infer a stall from time alone. State is session-scoped; concurrent children cannot stop each other. Checkpoints use bounded text with common credential/header/query/CLI-flag redaction and stay inside existing session storage. Synthetic fixtures only in public commits.

## Success criteria
Two matching failures trigger the latch; calls already accepted in the same parallel batch may finish. Zero subsequent tool calls are accepted after latch, preserved diagnostic/source history, exactly scoped child and coordinator handling, and passing native integration tests including workflow result delivery.

## Implementation clarifications — 2026-10-20
The SDK marks automatic schema repairs as interactive input. Explicit reset therefore replaces the planned ordinary-user-input reset to prevent silent reopening. Pi prepares parallel tool batches before collecting results; accepted calls may finish, while the next model continuation is stopped. These limits have runtime regression tests.
