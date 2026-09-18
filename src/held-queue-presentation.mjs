export function formatHeldInitialTime(value) {
  const date = new Date(Number(value));
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `最初加入待办：${day} ${time}`;
}

export function orderHeldForView(items, view) {
  if (view !== "time") return items;
  return [...items].sort((left, right) => (
    left.heldAt - right.heldAt || String(left.id).localeCompare(String(right.id))
  ));
}

export function createHeldDisplayRow(kind, text, actions, heldAt = null) {
  const row = document.createElement("div"); row.dataset.cccHeldRow = "";
  const timeHint = formatHeldInitialTime(heldAt);
  const badge = document.createElement("span"); badge.dataset.cccHeldKind = ""; badge.textContent = kind; badge.title = timeHint;
  const content = document.createElement("span"); content.dataset.cccHeldText = ""; content.textContent = text; content.title = timeHint ? `${text}\n${timeHint}` : text;
  const controls = document.createElement("span"); controls.dataset.cccHeldActions = ""; actions.forEach((action) => controls.append(action));
  row.append(badge, content, controls);
  return row;
}

export function createHeldEditRow(kind, held, value, actions, onInput) {
  const row = document.createElement("div"); row.dataset.cccHeldRow = ""; row.dataset.editing = "true";
  const timeHint = formatHeldInitialTime(held.heldAt);
  const badge = document.createElement("span"); badge.dataset.cccHeldKind = ""; badge.textContent = kind; badge.title = timeHint;
  const editor = document.createElement("textarea"); editor.dataset.cccHeldEditor = ""; editor.value = value; editor.title = timeHint; editor.rows = 3;
  editor.addEventListener("input", onInput);
  const controls = document.createElement("span"); controls.dataset.cccHeldActions = ""; actions.forEach((action) => controls.append(action));
  row.append(badge, editor, controls);
  return { row, editor };
}
