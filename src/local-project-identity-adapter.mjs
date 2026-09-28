import { LocalProjectSyncAdapter } from './local-project-sync-adapter.mjs';
import { assertExpected } from './project-sync-git.mjs';
import { validateRegisteredRoot } from './project-sync-git-validation.mjs';
import { syncError, syncProjectId } from './project-sync-contract.mjs';

export class LocalProjectIdentityAdapter extends LocalProjectSyncAdapter {
  constructor({ identityStore = null, ...options }) { super(options); this.identityStore = identityStore; }

  async catalog() {
    const result = await super.catalog();
    if (!this.identityStore) return result;
    const entries = await this.identityStore.read();
    return { projects: result.projects.map(project => ({ ...project, identitySupported: true, sharedProjectId: entries.get(project.path) || null })) };
  }

  async inspect(input) {
    const snapshot = await super.inspect(input);
    if (!this.identityStore) return snapshot;
    return { ...snapshot, identitySupported: true, sharedProjectId: (await this.identityStore.read()).get(snapshot.path) || null };
  }

  async associate({ path, expected, projectId } = {}) {
    if (!this.identityStore) throw syncError('该设备尚未支持项目关联，请先升级控制台', 503);
    syncProjectId(projectId);
    if (expected?.identitySupported !== true || !Object.hasOwn(expected, 'sharedProjectId')) throw syncError('项目关联缺少预检状态', 400);
    if (expected.sharedProjectId !== null && expected.sharedProjectId !== projectId) throw syncError('不能覆盖已有共享项目关联，请先解除误关联');
    assertExpected(await this.inspect({ path }), expected);
    return this.identityStore.set(path, expected.sharedProjectId, projectId);
  }

  async dissociate({ path, projectId } = {}) {
    if (!this.identityStore) throw syncError('该设备尚未支持项目关联，请先升级控制台', 503);
    syncProjectId(projectId);
    await validateRegisteredRoot(path, (await this.catalog()).projects);
    return this.identityStore.set(path, projectId, null);
  }
}
