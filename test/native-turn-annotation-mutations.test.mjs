import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeAnnotationMutationNeedsRefresh } from '../src/native-turn-annotation-adapter.mjs';

const selector = '[data-thread-user-message-navigation-content],[data-thread-user-message-navigation-item-id],[data-above-composer-conversation-id],[class*="rounded-3xl"][class*="bg-surface-elevated-secondary"]';
function element({ own = false, inside = false, descendant = false } = {}) {
  return { nodeType: 1, matches: value => value === selector && own, closest: value => value === selector && inside ? {} : null,
    querySelector: value => value === selector && descendant ? {} : null };
}
const childList = (target, addedNodes = [], removedNodes = []) => ({ type: 'childList', target, addedNodes, removedNodes });

test('annotation refresh follows conversation and output mounts, removals and internal changes', () => {
  const unrelated = element();
  assert.equal(nativeAnnotationMutationNeedsRefresh([childList(unrelated, [element({ own: true })])]), true);
  assert.equal(nativeAnnotationMutationNeedsRefresh([childList(unrelated, [], [element({ descendant: true })])]), true);
  assert.equal(nativeAnnotationMutationNeedsRefresh([childList(element({ inside: true }), [unrelated])]), true);
});

test('annotation refresh ignores unrelated sidebar changes and attributes', () => {
  const unrelated = element();
  assert.equal(nativeAnnotationMutationNeedsRefresh([childList(unrelated, [element()])]), false);
  assert.equal(nativeAnnotationMutationNeedsRefresh([childList(element({ descendant: true }), [unrelated])]), false);
  assert.equal(nativeAnnotationMutationNeedsRefresh([{ type: 'attributes', target: element({ own: true }), attributeName: 'class' }]), false);
});
