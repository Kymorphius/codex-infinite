// Native DOM/React read adapter: never infer conversation identity from tab titles.
export function readNativeAnnotationContext(document) {
  if (document.querySelector('[data-codex-control-console-workspace]')) return null;
  const content = document.querySelector('[data-thread-user-message-navigation-content]');
  if (!content) return null;
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const fiberKey = Object.keys(content).find(key => key.startsWith('__reactFiber'));
  let fiber = content[fiberKey], threadId = null;
  for (let i = 0; fiber && i < 45; i++, fiber = fiber.return) {
    const props = fiber.memoizedProps;
    if (uuid(props?.conversationId) && props.hostId === 'local') { threadId = props.conversationId.toLowerCase(); break; }
  }
  if (!threadId) return null;
  const scroll = content.closest('[data-app-action-timeline-scroll]');
  const host = scroll?.parentElement?.parentElement;
  const markers = Array.from(document.querySelectorAll('[data-thread-user-message-navigation-item-id]')).filter(node => node.getBoundingClientRect().width > 0);
  const turns = [], add = (id, node, marker) => {
    if (!uuid(id)) return;
    id = id.toLowerCase();
    let turn = turns.find(turn => turn.id === id);
    if (!turn) { turn = { id, anchor: node, markers: [] }; turns.push(turn); }
    if (marker) turn.markers.push(marker);
  };
  for (const marker of markers) add(marker.getAttribute('data-thread-user-message-navigation-item-id').split(':')[0], null, marker);
  for (const node of content.querySelectorAll('[data-turn-key]')) {
    const id = node.getAttribute('data-turn-key').match(/(?:^|:)turn:([^:]+)$/)?.[1]?.toLowerCase();
    if (!uuid(id)) continue;
    add(id, node, null);
    const turn = turns.find(turn => turn.id === id); if (turn) turn.anchor = node;
  }
  return { threadId, turns, host, content };
}
