const KIND_LABELS = Object.freeze({
  command: "运行命令",
  writeStdin: "向终端输入",
  fileChange: "修改文件",
  permissions: "授予额外权限"
});

export function presentApproval(approval, deviceName = "所属设备") {
  const facts = [];
  if (approval.command) facts.push(Object.freeze({ kind: "command", label: "命令", value: approval.command }));
  if (approval.cwd) facts.push(Object.freeze({ kind: "path", label: "目录", value: approval.cwd }));
  if (approval.networkHost) facts.push(Object.freeze({ kind: "network", label: "网络", value: approval.networkHost }));
  for (const value of approval.permissionSummary || []) facts.push(Object.freeze({ kind: "permission", label: "权限", value }));
  return Object.freeze({
    token: approval.token,
    turnId: approval.turnId,
    title: KIND_LABELS[approval.kind] || "确认操作",
    reason: approval.reason || "Codex 正在等待你的确认",
    device: deviceName,
    scope: "仅允许这一次，不会更改长期规则",
    facts: Object.freeze(facts),
    canAccept: approval.decisions?.includes("accept") || false,
    canDecline: approval.decisions?.includes("decline") || false
  });
}

export function approvalControlRequest(task, approval, decision) {
  if (!task?.id || !task?.device?.id || !["accept", "decline"].includes(decision) || !approval?.decisions?.includes(decision)) {
    throw new Error("审批操作无效");
  }
  return Object.freeze({
    url: `/api/tasks/${encodeURIComponent(task.id)}/control?device=${encodeURIComponent(task.device.id)}`,
    body: Object.freeze({
      action: "resolveApproval",
      turnId: approval.turnId,
      approvalToken: approval.token,
      decision
    })
  });
}

