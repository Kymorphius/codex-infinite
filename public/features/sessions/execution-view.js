import { conversationEntryKey, conversationEntrySignature } from "./conversation-model.js";

const STATUS_LABELS = Object.freeze({
  requested: "已请求",
  in_progress: "进行中",
  completed: "已完成",
  failed: "失败",
  declined: "已拒绝",
  cancelled: "已取消"
});

function appendText(parent, tagName, className, text, documentRef) {
  const element = documentRef.createElement(tagName);
  element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function detailSection(label, value, truncated, documentRef) {
  const section = documentRef.createElement("section");
  section.className = "execution-section";
  const header = documentRef.createElement("header");
  appendText(header, "span", "execution-section-label", label, documentRef);
  if (truncated) appendText(header, "span", "execution-truncated", "内容过长，已截断", documentRef);
  const content = documentRef.createElement("pre");
  content.className = "execution-raw";
  content.tabIndex = 0;
  content.textContent = value;
  section.append(header, content);
  return section;
}

export function renderExecutionEntry(entry, index, { formatDate, documentRef = document } = {}) {
  const item = documentRef.createElement("article");
  item.className = "conversation-entry execution-entry";
  item.dataset.kind = "tool";
  item.dataset.role = "system";
  item.dataset.entryKey = conversationEntryKey(entry, index);
  item.dataset.entrySignature = conversationEntrySignature(entry);

  const disclosure = documentRef.createElement("details");
  disclosure.className = "execution-card";
  const summary = documentRef.createElement("summary");
  summary.className = "execution-summary";
  const identity = documentRef.createElement("span");
  identity.className = "execution-identity";
  appendText(identity, "strong", "execution-name", entry.name || "工具", documentRef);
  const status = appendText(identity, "span", "execution-status", STATUS_LABELS[entry.status] || entry.status || "已请求", documentRef);
  status.dataset.status = entry.status || "requested";

  const availability = documentRef.createElement("span");
  availability.className = "execution-availability";
  if (entry.input !== null) appendText(availability, "span", "execution-chip", "输入", documentRef);
  if (entry.output !== null) appendText(availability, "span", "execution-chip", "输出", documentRef);
  else appendText(availability, "span", "execution-chip is-waiting", "等待输出", documentRef);
  summary.append(identity, availability);
  if (entry.timestamp) {
    const time = appendText(summary, "time", "execution-time", formatDate(entry.timestamp), documentRef);
    time.dateTime = entry.timestamp;
  }

  const body = documentRef.createElement("div");
  body.className = "execution-body";
  if (entry.input !== null) body.append(detailSection("输入", entry.input, entry.inputTruncated, documentRef));
  if (entry.output !== null) body.append(detailSection("输出", entry.output, entry.outputTruncated, documentRef));
  if (entry.input === null && entry.output === null) {
    appendText(body, "p", "execution-empty", "所属节点没有提供这一步的详细记录。", documentRef);
  }
  disclosure.append(summary, body);
  item.append(disclosure);
  return item;
}
