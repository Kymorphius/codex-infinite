import fs from 'node:fs/promises';
import path from 'node:path';
import { AppServerClient } from '../src/app-server-client.mjs';
import { NativeProjectSidebarRegistry } from '../src/native-project-sidebar-registry.mjs';
import { cloneNativeProject } from '../src/native-project-clone.mjs';

const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const manifest = JSON.parse(await fs.readFile(config.manifestPath, 'utf8'));
const client = new AppServerClient({ codexPath: config.codexPath, codexHome: config.codexHome, timeoutMs: 300000 });
try {
  const receipt = await cloneNativeProject({ ...config, manifest, client,
    registry: new NativeProjectSidebarRegistry({ homes: config.sidebarHomes || [config.codexHome] }),
    progress: state => { if (state.index % 20 === 0 || state.index === state.total) console.log(JSON.stringify(state)); }
  });
  console.log(JSON.stringify({ projectId: receipt.projectId, sidebarProjectId: receipt.sidebarProjectId, sessions: receipt.sessions.length, receipt: path.resolve(config.receiptPath) }));
} finally { client.close(); }
