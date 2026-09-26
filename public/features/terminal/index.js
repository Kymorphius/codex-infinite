import { createLegacyTerminalFeature } from './legacy.js';
import { createManagedTerminalFeature } from './managed.js';

export function createTerminalFeature(options) {
  const params = new URLSearchParams(location.search);
  // Old raw PTY links remain usable while all new entry points use stable conversations.
  return params.has('session') && !params.has('conversationId') && params.get('view') !== 'conversation'
    ? createLegacyTerminalFeature(options) : createManagedTerminalFeature(options);
}
