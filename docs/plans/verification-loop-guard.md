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
