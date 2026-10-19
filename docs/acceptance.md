# Acceptance register

| Request | Evidence | State |
|---|---|---|
| R027: Public portable Pi package following rules | Validated exact targets; package manifest and native loader tests; MIT; English README/config/recovery/benchmarks; independent convergence review | Implementation verified; delivery tracked in the initial GitHub PR and version tag |
| Preserve working setup and one slot | This repository changes no active installation, provider or server configuration | Verified for this packaging work |
| Honest performance claims | docs/benchmarks.md states single samples, earlier policy scope, server vs elapsed time and absence of a multi-hour stability claim | Verified |

## Requirement evidence

- FR-01: lib/config.mjs; test/config.test.mjs; test/package-runtime.test.mjs.
- FR-02/03: lib/compaction.mjs; unit and real-native compaction tests, including split-turn failure and smaller reserve-based budgets.
- FR-04: lib/context.mjs; policy recovery/conservation tests and actual native shell/agent-loop timeout tests.
- FR-05: context tool controller and registered helpers; branch restoration/model switch unit tests and schema projection in the actual Pi agent loop.
- FR-06: package.json peer/dev dependencies, explicit resource manifest and package-lock.json.
- FR-07: npm test; synthetic provider setup and both actual extension entries discovered through the package manifest.
- FR-08: LICENSE, README, CONTRIBUTING, benchmark limitations; local package-content/privacy checks and public delivery recorded in the GitHub PR.

The compatibility baseline is Pi 1.3.0. Tests do not make inference calls. Historical live measurements and unmeasured long-session behavior are explicitly distinguished in the benchmark document.
