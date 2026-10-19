# Public package plan

## Technical context
Pi/pi-ai 1.3.0; ESM JavaScript policies, TypeScript extension entries, Node test runner. Host imports are wildcard peers; development dependencies pin the tested release. No runtime dependency or CI service.

## Structure
extensions/: thin entries; lib/: validated config and policies; test/: synthetic unit/SDK tests; examples/: opt-in config; README/CHANGELOG/LICENSE/CONTRIBUTING/docs/: installation, limitations, requirements and evidence.

## Ordered steps
1. Commit spec and acceptance on a feature branch over a minimal main bootstrap.
2. Port policies with exact targets, validated config and provider-specific payload guards.
3. Make tests portable with synthetic SDK providers and ordinary package resolution; run tests.
4. Write documentation/licensing/benchmark limits; scan public files and package contents.
5. Clean-context reviewer compares implementation with spec/plan; resolve gaps with regression tests.
6. Create authorized public repo, push main/feature, open a PR, complete reviewed release and tag it.
7. Verify visibility, refs and Pi package discovery; update shared status and deliver URL.

## Complexity
No choice exceeds the simplest portable package. Global-only config avoids project trust/precedence complexity.

## Residual work (append-only)

- FR-03 / high: Native file metadata could disguise an empty generated summary; resolved by validating every stream result before native assembly, with non-split and both split-part regressions.
- FR-03 / medium: A smaller reserve-based native output allowance could be raised by the wrapper; resolved by taking the minimum per request, verified at 819/512 tokens with reserve 1024.
- FR-04 / medium: Missing/truncated structured captures, including text-only native timeout errors, were not positively proven complete; resolved by requiring explicit complete structured output, with an actual agent-loop timeout regression.
- Code convergence: no remaining implementation gaps after the fixes above. Public URL/ref verification is the subsequent release step.
