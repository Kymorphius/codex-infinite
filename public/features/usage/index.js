import { requestJson } from '../../core/transport.js';

export function createUsageFeature({ $, formatDate }) {
  const panel = $('[data-module-panel="usage"]');
  const status = $('[data-testid="account-usage-status"]');
  const list = $('[data-testid="account-usage-list"]');

  function render(windows) {
    list.replaceChildren(...windows.map((window) => {
      const item = document.createElement('article');
      item.className = 'account-usage-window';
      const title = document.createElement('h3');
      const duration = window.windowDurationMins === 300 ? '5 小时' : window.windowDurationMins === 10080 ? '一周' : window.windowDurationMins ? `${window.windowDurationMins} 分钟` : '额度窗口';
      title.textContent = `${window.label === 'codex' ? 'Codex' : window.label} · ${duration}`;
      const amount = document.createElement('strong');
      amount.textContent = `${window.usedPercent}% 已用`;
      const progress = document.createElement('progress');
      progress.max = 100;
      progress.value = window.usedPercent;
      progress.setAttribute('aria-label', `${title.textContent}已用比例`);
      const reset = document.createElement('p');
      reset.textContent = window.resetsAt ? `重置时间：${formatDate(window.resetsAt * 1000)}` : '重置时间暂不可用';
      item.append(title, amount, progress, reset);
      return item;
    }));
  }

  async function load() {
    status.textContent = '正在读取账号用量…';
    try {
      const data = await requestJson('/api/account-usage', { cache: 'no-store' });
      const windows = Array.isArray(data.windows) ? data.windows : [];
      render(windows);
      status.textContent = windows.length ? '' : '当前账号未返回可用的额度窗口。';
    } catch {
      list.replaceChildren();
      status.textContent = '账号用量暂时不可读取，请稍后刷新。';
    }
  }

  function bind() {
    panel.addEventListener('click', (event) => {
      if (event.target.closest('[data-action="refresh-usage"]')) void load();
    });
  }

  return { bind, load };
}
