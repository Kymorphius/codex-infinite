export function placeNativeBoardBelowChecklist(board, checklist) {
  const parent = checklist?.parentElement;
  if (!board || !parent || (board.parentElement === parent && board.previousElementSibling === checklist)) return false;
  parent.insertBefore(board, checklist.nextSibling);
  return true;
}
