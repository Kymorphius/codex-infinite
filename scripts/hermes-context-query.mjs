import { getConfig } from '../src/config.mjs';
import { GptContextCatalog } from '../src/gpt-context-catalog.mjs';
import { GptContextService } from '../src/gpt-context-service.mjs';

try {
  process.stdin.setEncoding('utf8');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 65536) throw new Error('查询参数过长。');
  }
  const { method, params = {} } = JSON.parse(input);
  if (!['listProjects', 'searchConversations', 'readConversation'].includes(method)) throw new Error('不支持的查询。');
  const config = getConfig();
  const catalog = new GptContextCatalog({ databasePath: config.threadStateDatabasePath,
    sessionRoots: [config.sessionRoot, config.archivedSessionRoot],
    titleIndexPath: config.sessionTitleIndexPath, device: config.nodeDevice });
  const result = await new GptContextService({ catalog })[method](params);
  const output = JSON.stringify(result);
  if (Buffer.byteLength(output) > 524288) throw new Error('查询结果过大。');
  process.stdout.write(output);
} catch (error) {
  process.stdout.write(JSON.stringify({ error: String(error.message || error) }));
  process.exitCode = 1;
}
