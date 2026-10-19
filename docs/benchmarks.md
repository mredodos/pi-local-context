# Earlier synthetic measurements

These measurements were taken during development of the original local policies on 2026-10-19, before portable packaging. They are observations of individual synthetic cases, not a statistical benchmark of the public package. The portable package retains the policy behavior and adds configurable targets and budgets. Its automated suite runs without inference.

## Native vs bounded compaction

Local Qwen 27B, Pi 1.3.0, llama.cpp, approximately 19.3k input tokens, a 98,304-token context and a single server slot. Ordinary model thinking was medium; the bounded summary used no thinking and a 2,048-token output cap. Conditions were paired by cold/warm cache; **one sample per condition**.

| Condition | Native | Bounded | Elapsed reduction |
|---|---:|---:|---:|
| Cold | 36,289 ms | 25,585 ms | 29.5% |
| Warm | 21,004 ms | 11,187 ms | 46.7% |

Ten synthetic compaction cases preserved 70/70 required anchors. Four continuation cases returned 28/28 checked facts. Native cut points and file metadata were also checked. This does not establish preservation of every possible instruction, image fact or long conversation.

## Reduced inputs under shared load

Four actual local model requests, one per case, were allowed to queue behind other work. All reported zero cache-read tokens; output lengths differed. All 14 checked facts were correct.

| Comparison | Original input | Selected input | Input reduction | Reported server prompt + decode time |
|---|---:|---:|---:|---:|
| Repetitive shell log | 16,822 tokens | 552 tokens | 96.7% | 16,877 → 3,834 ms |
| Optional tool schemas | 10,462 tokens | 5,906 tokens | 43.5% | 8,759 → 5,926 ms |

Total client durations were 22,251 → 149,519 ms for the logs and 33,771 → 62,822 ms for the schemas. Unequal server waiting dominated these totals, so they are **not** an estimate of latency improvement or regression. Elapsed time minus reported server time also includes client/network overhead; it is not an exact queue timer. The server work reductions were 77.3% and 32.3% in these individual samples, with no confidence interval.

A 50-cycle offline simulation produced 16 → 0 compactions using native thresholds and fixed synthetic summaries. This is **not** a measured multi-hour session result and is not a release performance promise.

## Reproducibility and limits

`npm test` reproduces correctness checks against synthetic logs and the actual Pi SDK without a model or account. The live measurements above are descriptive: private machine setup, session captures and benchmark drivers that depend on local credentials are deliberately not distributed. The repository does not provide an exact reproduction harness for the historical live timings.

For new measurements, use synthetic tasks, hold model/server/token limits/cache state constant, repeat each paired condition and report distributions. Measure normal answers as well as compactions and verify task facts after summarization. Record reported server prompt/decode time separately from client elapsed time when requests queue. Actual benefits depend on how much repetitive output and optional schema text your workload contains.
