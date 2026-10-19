import { isTarget, validateConfig } from './config.mjs';

/** Bounded local compaction that preserves native cut points and file tracking. */
export const SUMMARY_TOKENS = 2048;
export const DEADLINE_MS = 120_000;


/** Collect original human messages from this branch, without assistant/tool impersonation. */
export function collectUserRequests(entries, maxProtectedChars = 20000) {
  const requests = [];
  for (const entry of entries) {
    const message = entry.type === 'message' ? entry.message : undefined;
    if (message?.role !== 'user') continue;
    const text = typeof message.content === 'string'
      ? message.content
      : (message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
    if (text.trim()) requests.push(text);
  }
  const text = requests.map((request, i) => `[${i + 1}] ${request}`).join('\n\n');
  return { text, count: requests.length, fits: text.length <= maxProtectedChars };
}

/** Only this summarization request gets non-thinking mode and a separate output budget. */
export function boundSummaryPayload(payload, { maxTokens = SUMMARY_TOKENS, disableThinking = false } = {}) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.messages)) {
    throw new Error('Unsupported summarization payload; no checkpoint was saved.');
  }
  const kwargs = payload.chat_template_kwargs;
  const requested = payload.max_tokens ?? payload.max_completion_tokens;
  const tokenLimit = Number.isSafeInteger(requested) && requested > 0
    ? Math.min(requested, maxTokens)
    : maxTokens;
  const result = {
    ...payload,
    max_tokens: tokenLimit,
    ...(disableThinking ? { chat_template_kwargs: {
      ...(kwargs && typeof kwargs === 'object' && !Array.isArray(kwargs) ? kwargs : {}),
      enable_thinking: false,
    } } : {}),
  };
  delete result.max_completion_tokens;
  if (disableThinking) delete result.reasoning_effort;
  return result;
}

const INSTRUCTIONS = `Produce a compact checkpoint of at most 450 words. Do not expand the old summary.
Keep: the current objective; explicit constraints and corrections; verified changes and their evidence;
unresolved errors and exact identifiers needed to continue; next actions. Preserve later corrections over
older plans. Separate verified facts from assumptions. Remove obsolete attempts, repeated explanations,
completed historical detail, and copied logs. Do not repeat entire file inventories: Pi appends them.
Original user messages are preserved separately, so do not paraphrase them at length. Preserve important
facts originating from images when they are explicitly recorded in the visible conversation.`;

/** Build the handler with the verified native compact() injected for offline regression tests. */
export function createCompactionHandler(nativeCompact, config = validateConfig()) {
  return async (event, ctx) => {
    const model = ctx.model;
    if (!config.compaction.enabled || !isTarget(model, config)) return;
    const { deadlineMs, maxTokens, maxProtectedChars, disableThinking } = config.compaction;
    if (model.api !== 'openai-completions') return;
    const { preparation } = event;
    if (!preparation?.firstKeptEntryId || !preparation.fileOps) return;
    const protectedRequests = collectUserRequests(event.branchEntries ?? [], maxProtectedChars);
    if (!protectedRequests.fits) {
      ctx.ui.notify('Fast compaction: user instructions exceed the protected budget; using native compaction.', 'warning');
      return;
    }
    const startedAt = Date.now();
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new Error('Fast compaction exceeded its configured deadline.')), deadlineMs);
    const signal = event.signal
      ? AbortSignal.any([event.signal, deadline.signal])
      : deadline.signal;
    ctx.ui.notify('Local context: generating a bounded checkpoint; normal response limits stay unchanged.', 'info');
    try {
      const boundedModel = { ...model, maxTokens: Math.min(maxTokens, model.maxTokens || maxTokens) };
      const instructions = [event.customInstructions, INSTRUCTIONS].filter(Boolean).join('\n\n');
      const stream = (summaryModel, context, options) => {
        const { reasoning, ...rest } = options;
        return ctx.modelRegistry.streamSimple(summaryModel, context, {
          ...rest,
          signal,
          maxTokens: boundedModel.maxTokens,
          timeoutMs: deadlineMs,
          maxRetries: 0,
          onPayload: payload => boundSummaryPayload(payload, { maxTokens: boundedModel.maxTokens, disableThinking }),
        });
      };
      const result = await nativeCompact(
        preparation, boundedModel, undefined, undefined, instructions, signal,
        'off', stream,
      );
      if (signal.aborted) throw signal.reason ?? new Error('Compaction cancelled.');
      if (!result?.summary?.trim()) throw new Error('Compaction returned an empty checkpoint.');
      const requests = protectedRequests.text
        ? `\n\n<original-user-messages>\nChronological source messages; later corrections supersede earlier instructions.\n${protectedRequests.text}\n</original-user-messages>`
        : '';
      const elapsedMs = Date.now() - startedAt;
      ctx.ui.notify(`Fast compaction complete in ${(elapsedMs / 1000).toFixed(1)}s.`, 'info');
      return {
        compaction: {
          ...result,
          summary: result.summary + requests,
          details: {
            ...result.details,
            fastCompaction: { version: 1, summaryTokenLimit: boundedModel.maxTokens, elapsedMs, protectedUserMessages: protectedRequests.count },
          },
        },
      };
    } catch (error) {
      if (event.signal?.aborted) return { cancel: true };
      const reason = deadline.signal.aborted ? `${deadlineMs / 1000}-second deadline reached` : 'checkpoint failed validation or generation';
      ctx.ui.notify(`Fast compaction stopped: ${reason}. History was preserved; no incomplete checkpoint was saved.`, 'error');
      return { cancel: true };
    } finally {
      clearTimeout(timer);
    }
  };
}
