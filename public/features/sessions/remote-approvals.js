import { approvalControlRequest, presentApproval } from "./approval-model.js";

export function createRemoteApprovals({ element, fetchImpl = fetch, onStatus = () => {}, onResolved = () => {} }) {
  let selectedTask = null;
  let currentApprovals = [];
  const pending = new Set();

  function factNode(fact) {
    const row = document.createElement("div");
    row.className = "conversation-approval-fact";
    row.dataset.kind = fact.kind;
    const label = document.createElement("span");
    label.textContent = fact.label;
    const value = document.createElement(fact.kind === "command" ? "code" : "strong");
    value.textContent = fact.value;
    row.append(label, value);
    return row;
  }

  function actionButton(label, decision, approval, task, primary = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = primary ? "conversation-approval-action is-primary" : "conversation-approval-action";
    button.textContent = label;
    button.disabled = pending.has(approval.token);
    button.addEventListener("click", () => void resolve(task, approval, decision));
    return button;
  }

  function cardNode(approval, task) {
    const view = presentApproval(approval, task.device?.name);
    const card = document.createElement("article");
    card.className = "conversation-approval-card";
    card.dataset.approvalToken = approval.token;
    const heading = document.createElement("div");
    heading.className = "conversation-approval-heading";
    const identity = document.createElement("div");
    const eyebrow = document.createElement("span");
    eyebrow.textContent = `${view.device} · 等待确认`;
    const title = document.createElement("h4");
    title.textContent = view.title;
    identity.append(eyebrow, title);
    const scope = document.createElement("span");
    scope.className = "conversation-approval-scope";
    scope.textContent = "仅本轮";
    heading.append(identity, scope);
    const reason = document.createElement("p");
    reason.textContent = view.reason;
    const facts = document.createElement("div");
    facts.className = "conversation-approval-facts";
    facts.replaceChildren(...view.facts.map(factNode));
    facts.classList.toggle("hidden", view.facts.length === 0);
    const footer = document.createElement("div");
    footer.className = "conversation-approval-footer";
    const note = document.createElement("span");
    note.textContent = pending.has(approval.token) ? "正在交给所属设备处理…" : view.scope;
    const actions = document.createElement("div");
    if (view.canDecline) actions.append(actionButton("拒绝", "decline", approval, task));
    if (view.canAccept) actions.append(actionButton("允许一次", "accept", approval, task, true));
    footer.append(note, actions);
    card.append(heading, reason, facts, footer);
    return card;
  }

  function render(approvals = [], task = selectedTask) {
    selectedTask = task;
    currentApprovals = Array.isArray(approvals) ? approvals : [];
    const visible = new Set(currentApprovals.map((approval) => approval.token));
    for (const token of pending) if (!visible.has(token)) pending.delete(token);
    element.replaceChildren(...currentApprovals.map((approval) => cardNode(approval, task)));
    element.classList.toggle("hidden", currentApprovals.length === 0);
  }

  async function resolve(task, approval, decision) {
    if (selectedTask !== task || pending.has(approval.token)) return;
    let request;
    try { request = approvalControlRequest(task, approval, decision); }
    catch (error) { onStatus(error.message, "error"); return; }
    pending.add(approval.token);
    render(currentApprovals, task);
    onStatus(decision === "accept" ? "正在允许这一次操作…" : "正在拒绝这次操作…", "sending");
    try {
      const response = await fetchImpl(request.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request.body)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
      if (selectedTask !== task) return;
      onStatus(decision === "accept" ? "所属设备已允许这一次操作" : "所属设备已拒绝这次操作", "accepted");
      onResolved();
    } catch (error) {
      pending.delete(approval.token);
      if (selectedTask !== task) return;
      render(currentApprovals, task);
      onStatus(`审批失败：${error.message}`, "error");
    }
  }

  function reset() {
    selectedTask = null;
    currentApprovals = [];
    pending.clear();
    element.replaceChildren();
    element.classList.add("hidden");
  }

  return { render, reset };
}

