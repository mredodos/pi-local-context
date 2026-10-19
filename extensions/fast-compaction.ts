import { compact, getAgentDir, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { readConfig } from '../lib/config.mjs';
import { createCompactionHandler } from '../lib/compaction.mjs';

/** Keep the host's compaction algorithm and bound only opted-in summary requests. */
export default function fastCompaction(pi: ExtensionAPI) {
  try {
    const config = readConfig(getAgentDir());
    pi.on('session_before_compact', createCompactionHandler(compact, config));
  } catch (error) {
    pi.on('session_start', (_event, ctx) => ctx.ui.notify(`pi-local-context disabled: ${error.message}`, 'error'));
  }
}
