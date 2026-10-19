# Public package specification

## Goal
Share the existing local context optimizations as an installable, portable Pi package without changing the working installation.

## Scope and assumptions
Bounded native compaction and conservative shell-log reduction with optional tool declarations. GitHub public repository and a Git-installable version are in scope. npm publication, upstream submissions, hosted CI, external summarizers, model/runtime installation and local configuration migration are outside this release. Pi 1.3.0 and Node >=22.19.0 are the compatibility baseline.

## User stories and acceptance
- US1 (P1): A Pi user installs from Git and opts in exact provider/model pairs. With no configuration, no model request is modified.
- US2 (P1): Only summary requests get bounded budgets. Native cut points, file tracking, retained tail and normal response limits remain intact. Failed/cancelled summaries never replace history. Human source text is appended in order; oversized protected text falls back visibly to native compaction.
- US3 (P1): Repetitive complete build/test output is shortened while diagnostics and unknown rows survive. Originals remain recoverable from the session branch, including before a compaction. Incomplete captures and nested tools are unchanged.
- US4 (P2): Explicit optional tool groups load on demand and remain stable for the branch. Base tools stay declared. Non-target models retain ordinary declarations.
- US5 (P1): Readers get English documentation, MIT licensing, honest benchmark limits and executable synthetic tests. No private logs, credentials, machine configuration or personal paths are published.

## Functional requirements
- FR-01: Exact opt-in targets, validated global JSON, no configuration writes; invalid configuration disables the package with a visible error.
- FR-02: Explicitly enabled compaction for openai-completions only, configurable token/deadline/protection budgets and explicit optional Qwen thinking override.
- FR-03: Preserve native compaction semantics; cancel on failure/deadline/empty summary. Preserve chronological human text without silent truncation.
- FR-04: Select recognized routine shell rows conservatively. Store original content/structured output in non-model-facing details; recover bounded pages by tool call ID.
- FR-05: Configurable optional tool groups, branch restoration, model switching and protected base tools; no permission bypass.
- FR-06: Pi manifest, host packages as peers, zero additional runtime dependencies, pinned development dependencies and lockfile.
- FR-07: Offline unit and real Pi SDK integration tests, including loader/agent loop, requiring no credentials or inference network.
- FR-08: Public repo, MIT license, install/config/remove instructions and qualified benchmark evidence; secret/private-path review before first push.

## Data model and interfaces
Global pi-local-context.json inside Pi's agent directory supplies targets, compaction settings, log enablement and named tool groups. Read once at load; /reload applies edits. Tool-result details store original logs; branch custom entries store loaded group names. Native session_before_compact, tool_result and session/model hooks integrate the policies. Helpers: context_log and context_tools.

## Security and performance
No independent credentials, endpoints, telemetry or storage service. No project configuration reads or provider writes. Selection bounded to 1 MiB, direct recognized shell commands only. Recovery capped at 400 lines/16k characters. Summary deadline includes server waiting, without retries. Incomplete source captures are never selected. Existing Pi session access and retention govern originals.

## Verification and success criteria
All tests pass against Pi 1.3.0. Package contains only source/docs/tests/manifests; no real sessions, secrets or machine paths. Real SDK loads both extensions and runs synthetic recovery/loading. Public main and version tag are readable and package discovery succeeds. Prior synthetic measurements never imply guaranteed session speedups.

## Clarifications — 2026-10-19
User explicitly authorized a public repository. Preserve one-slot service and installed extensions.

## Open questions
None blocking release.
