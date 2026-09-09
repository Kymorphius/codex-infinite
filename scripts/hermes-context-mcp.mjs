import { getConfig } from '../src/config.mjs';
import { GptContextCatalog } from '../src/gpt-context-catalog.mjs';
import { GptContextService } from '../src/gpt-context-service.mjs';
import { createGptContextRpc, serveGptContextStdio } from '../src/gpt-context-mcp.mjs';

const config = getConfig();
const catalog = new GptContextCatalog({ databasePath: config.threadStateDatabasePath,
  sessionRoots: [config.sessionRoot, config.archivedSessionRoot],
  titleIndexPath: config.sessionTitleIndexPath, device: config.nodeDevice });
await serveGptContextStdio({ dispatch: createGptContextRpc(new GptContextService({ catalog })) });
