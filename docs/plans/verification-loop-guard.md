# Verification loop guard plan

## Verified environment
Pi1.3.0 supports same-role message_end replacement, blocking tool_call and turn_end continue:false. Workflow3.14.0 accepts an explicit providerMiddlewareExtensions filename allowlist and binds child extension hooks before prompt. Its unstructured collector requires terminal assistant text after tool results, so a custom message alone is insufficient.

## Design
lib/loop-guard.mjs: deterministic bounded signatures/progress state, checkpoint and tool policy.
lib/guard-files.mjs: bounded local file fingerprints and path confinement.
extensions/loop-guard.ts: native hooks, status and reset, child-safe factory.
Tests: pure state conservation plus actual Pi and WorkflowAgent loops; no application execution.

| Choice | Reason | Simpler alternative |
|---|---|---|
| Same-role final replacement | Coordinator must receive a terminal BLOCKED checkpoint even when the model ignores instructions | Abort/custom-message alone is reported as empty output by workflow and can be retried |
| Bounded source witnesses | Changed scripts and source fixes must not be mistaken for identical stalled retries | Successful arbitrary tool calls are not proof of source progress |

## Steps
1. Commit scope/spec and request record.
2. Implement policies/config and unit tests.
3. Bind native hooks and prove enforcement/result delivery with SDK/workflow tests.
4. Review docs/privacy and clean-context convergence; resolve gaps.
5. Install child-safe guard and allowlist, preserving existing setup; verify isolated discovery.
6. Publish focused PR, update shared notes and hand over reload instruction.

## Residual work (append-only)
- Review round 1: SDK automatic input reset allowed fabricated structured success and automatic coordinator continuation. Resolved by explicit-command/source-change reset; native WorkflowAgent schema failure and coordinator tests added.
- Review round 1: Workflow handoff dropped original output, path parsing missed spaces/.h, root reports could simulate progress, command flags were not redacted, and quoted arguments could look like shell commands. Each corrected with regression coverage.
- Review round 1: Pi accepts parallel batches before execution. Scope clarified to subsequent calls; a four-check synthetic batch proves accepted work finishes and later writes remain blocked. No global scheduling change.
- Review round 2: Keyword-only fingerprints merged different TAP actual/expected values and dropped stack source paths. Full bounded capture signatures/source parsing replace them; incomplete/oversized captures cannot prove matching. Falsy structured values preserved.
- Review round 2: Native provider retry bypassed the first checkpoint delivery. Every assistant response while blocked now retains the checkpoint and continuation cap; a real SDK retry regression covers 503 then fabricated pass.
- Final clean-context review: all reported reproductions resolved, 29/29 focused synthetic tests; no concrete residual gap in the reviewed snapshot. Full suite subsequently passes 71/71 on Linux and native Windows. Local stub/child allowlist probe passes with two failed checks, zero subsequent writes and BLOCKED handoff.
