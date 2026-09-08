import { getConfig } from "../src/config.mjs";
import { prepareWrapperCodexHome } from "../src/wrapper-codex-home.mjs";

const config = getConfig();
const result = await prepareWrapperCodexHome({
  sourceHome: config.sourceCodexHome,
  wrapperHome: config.wrapperCodexHome,
  contextWindow: config.perThreadContextWindow
});
console.log(JSON.stringify({
  wrapperHome: result.wrapperHome,
  profileDirectory: config.profileDirectory,
  sharedEntries: result.sharedEntries.length
}));
