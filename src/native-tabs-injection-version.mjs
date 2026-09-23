import { createHash } from 'node:crypto';
import { buildNativeConversationTabsInjectionSource } from './native-conversation-tabs.mjs';

export function buildVersionedNativeTabsSource() {
  const nativeConversationTabsSource = buildNativeConversationTabsInjectionSource();
  const digest = createHash('sha256').update(nativeConversationTabsSource).digest('hex').slice(0, 12);
  return { nativeConversationTabsSource, digest };
}
