export function createNativeSaveDraftTodoButton(saveDraftTodo) {
  return () => {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = '存待办';
    node.addEventListener('pointerdown', (event) => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
    node.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
    node.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); void saveDraftTodo(); }, true);
    return node;
  };
}
