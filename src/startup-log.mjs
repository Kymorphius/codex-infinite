export function logStartup({ config, codex, wrapper, log = console.log }) {
  log(`[codex-control-console] dashboard listening at ${config.dashboardOrigin}`);
  log(`[codex-control-console] CDP ${codex.mode} on ${config.cdpOrigin}`);
  log(`[codex-control-console] dedicated profile: ${config.profileDirectory}`);
  log(`[codex-control-console] wrapper CODEX_HOME: ${wrapper.wrapperHome}`);
  log("[codex-control-console] regular-chat context: model default");
  log(`[codex-control-console] per-thread extended context request: ${wrapper.requestedContextWindow}`);
}
