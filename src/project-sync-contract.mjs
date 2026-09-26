export function syncError(message, statusCode = 409) {
  return Object.assign(new Error(message), { statusCode });
}

export function syncSelection(value) {
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value.deviceId || '')
    || typeof value.path !== 'string' || !value.path || value.path.length > 4096 || /[\0\r\n]/.test(value.path)) {
    throw syncError('请选择有效的设备和项目目录', 400);
  }
  return { deviceId: value.deviceId, path: value.path };
}

export function syncSnapshot(value, selection) {
  if (!value || value.path !== selection.path || value.clean !== true
    || typeof value.branch !== 'string' || !value.branch || value.branch.length > 1024 || /[\0\r\n]/.test(value.branch)
    || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.head || '')) {
    throw syncError('设备未返回可确认的洁净 Git 版本，请重新检查');
  }
  return { ...selection, branch: value.branch, head: value.head, clean: true };
}

export function sameSyncVersion(a, b) {
  return a.path === b.path && a.branch === b.branch && a.head === b.head && a.clean === b.clean;
}

export function syncToken(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) throw syncError('同步预检凭据无效', 400);
  return value;
}

export function syncProjects(catalog) {
  if (!catalog || !Array.isArray(catalog.projects) || catalog.projects.length > 5000) throw syncError('设备未提供项目目录，可能需要升级控制台', 503);
  const paths = new Set();
  return catalog.projects.map(project => {
    if (!project || typeof project.path !== 'string' || !project.path || project.path.length > 4096 || /[\0\r\n]/.test(project.path)
      || typeof project.name !== 'string' || project.name.length > 512 || paths.has(project.path)) throw syncError('设备项目目录格式无效', 503);
    paths.add(project.path);
    return { path: project.path, name: project.name };
  });
}
