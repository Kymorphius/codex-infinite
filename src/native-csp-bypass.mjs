import { waitForReloadedNativeDocument } from "./native-document-bootstrap.mjs";

export async function prepareNativeCspBypass(connection, { reloadAfterCspBypass = true } = {}) {
  await connection.send("Page.setBypassCSP", { enabled: true });
  const tokenSource = `(() => {
    if (!window.__codexControlConsoleCspDocumentToken) {
      window.__codexControlConsoleCspDocumentToken = globalThis.crypto?.randomUUID?.() || String(Date.now()) + Math.random();
    }
    return window.__codexControlConsoleCspDocumentToken;
  })()`;
  if (!connection.__codexControlConsoleCspTokenScriptPrepared) {
    await connection.send("Page.addScriptToEvaluateOnNewDocument", {
      source: "window.__codexControlConsoleCspDocumentToken = globalThis.crypto?.randomUUID?.() || String(Date.now()) + Math.random();"
    });
    connection.__codexControlConsoleCspTokenScriptPrepared = true;
  }
  const documentToken = await connection.evaluate(tokenSource).catch(() => null);
  if (connection.__codexControlConsoleCspPrepared && connection.__codexControlConsoleCspDocumentToken === documentToken) return false;
  connection.__codexControlConsoleCspPrepared = true;
  connection.__codexControlConsoleCspDocumentToken = documentToken;
  if (!reloadAfterCspBypass) {
    await connection.evaluate("window.__codexControlConsoleCspDocumentPrepared = true;").catch(() => {});
    return false;
  }
  await connection.send("Page.reload", { ignoreCache: false });
  await waitForReloadedNativeDocument(connection, documentToken);
  connection.__codexControlConsoleCspDocumentToken = await connection.evaluate(tokenSource).catch(() => null);
  return true;
}
