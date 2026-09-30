import { createHash } from 'node:crypto';
import { buildNativeConversationTabsInjectionSource } from './native-conversation-tabs.mjs';

export function versionNativeTabsSource(source) {
  const digest = createHash('sha256').update(source).digest('hex').slice(0, 12);
  // The outer installer already tracks this digest. The inner controller must
  // track it too, otherwise its fixed-version guard keeps the old stylesheet.
  const marker = /(function installNativeConversationTabs\(options\) \{\s+const VERSION = )(['"])([^'"\r\n]+)\2;/;
  if (!marker.test(source)) throw new Error('Native conversation tabs installer version is missing');
  const nativeConversationTabsSource = source.replace(marker, (_match, prefix, _quote, version) =>
    prefix + JSON.stringify(`${version}.source-${digest}`) + ';');
  return { nativeConversationTabsSource, digest };
}

export function buildVersionedNativeTabsSource() {
  return versionNativeTabsSource(buildNativeConversationTabsInjectionSource());
}
