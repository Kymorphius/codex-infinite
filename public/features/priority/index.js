export function priorityMetrics(projects = [], connected = true) {
  return {
    projectCount: connected ? String(projects.length) : "—",
    recentCount: connected ? String(projects.reduce((sum, project) => sum + (project.recentSessionCount || 0), 0)) : "—",
    source: connected ? "本机记录" : "不可用"
  };
}

export function createPriorityFeature({ state, $, formatDate, formatDuration }) {
  const panel = $('[data-module-panel="priority"]');
  const list = $('[data-testid="priority-list"]');

  function projectCard(project, index) {
    const card = document.createElement("article");
    card.className = "priority-card";
    card.dataset.project = project.project;
    const rank = document.createElement("div");
    rank.className = "priority-rank";
    const rankLabel = document.createElement("span");
    rankLabel.textContent = "排名";
    const rankValue = document.createElement("strong");
    rankValue.textContent = String(index + 1);
    rank.append(rankLabel, rankValue);
    const body = document.createElement("div");
    body.className = "priority-card-body";
    const heading = document.createElement("div");
    heading.className = "priority-card-heading";
    const name = document.createElement("h3");
    name.textContent = project.project;
    const latest = document.createElement("span");
    latest.textContent = `最近对话 ${formatDate(project.lastConversationAt)}`;
    heading.append(name, latest);
    const task = document.createElement("p");
    task.className = "priority-latest-task";
    task.textContent = project.latestTask?.title || "暂无可读取会话标题";
    const stats = document.createElement("div");
    stats.className = "priority-stats";
    for (const text of [`${project.taskCount} 个会话`, `近 7 天 ${project.recentSessionCount} 个`, `运行跨度 ${formatDuration(project.totalRuntimeMs)}`]) {
      const span = document.createElement("span");
      span.textContent = text;
      stats.append(span);
    }
    body.append(heading, task, stats);
    const score = document.createElement("div");
    score.className = "priority-score";
    const scoreValue = document.createElement("strong");
    scoreValue.textContent = String(project.priorityScore);
    const scoreLabel = document.createElement("span");
    scoreLabel.textContent = "优先级";
    const scoreDetail = document.createElement("small");
    scoreDetail.textContent = `活跃 ${project.recencyWeight} · 时长 ${project.runtimeWeight}`;
    score.append(scoreValue, scoreLabel, scoreDetail);
    card.append(rank, body, score);
    return card;
  }

  function render() {
    list.replaceChildren(...state.projects.map(projectCard));
  }

  function setTaskState(responseStatus, label, source, message = "") {
    for (const element of panel.querySelectorAll("[data-priority-state]")) element.classList.toggle("hidden", element.getAttribute("data-priority-state") !== responseStatus);
    for (const element of panel.querySelectorAll("[data-priority-state-message]")) if (message) element.textContent = message;
    const connected = responseStatus === "connected";
    const metrics = priorityMetrics(state.projects, connected);
    $('[data-testid="priority-project-count"]').textContent = metrics.projectCount;
    $('[data-testid="priority-recent-count"]').textContent = metrics.recentCount;
    $('[data-testid="priority-source"]').textContent = source;
    $('[data-testid="priority-connection-status"]').textContent = label;
    list.classList.toggle("hidden", !connected);
  }

  return { render, setTaskState };
}
