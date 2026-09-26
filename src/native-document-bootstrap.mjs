export function deferNativeDocumentSource(source) {
  return `(() => {
    const runtimeReady = () => {
      if (!document.documentElement || !document.body || typeof globalThis.crypto?.randomUUID !== 'function') return false;
      try { void localStorage.length; return true; } catch { return false; }
    };
    const install = () => { if (runtimeReady()) { ${source} } else setTimeout(install, 50); };
    if (document.documentElement && document.body) install();
    else window.addEventListener('DOMContentLoaded', install, { once: true });
  })()`;
}

export async function waitForReloadedNativeDocument(connection, previousToken = null, { attempts = 24, wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) } = {}) {
  const previous = JSON.stringify(previousToken);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const ready = await connection.evaluate(`(() => {
      const readyState = document.readyState === 'interactive' || document.readyState === 'complete';
      const token = window.__codexControlConsoleCspDocumentToken || null;
      return Boolean(document.documentElement && document.body && readyState
        && (${previous} === null || (token && token !== ${previous})));
    })()`).catch(() => false);
    if (ready) return;
    await wait(250);
  }
  throw new Error("Codex renderer did not become ready after enabling dashboard compatibility");
}
