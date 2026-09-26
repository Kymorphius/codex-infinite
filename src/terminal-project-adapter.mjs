// The native project owner is consulted before accepting a persisted reference.
export function createTerminalProjectValidator(nativeSidebarAdapter) {
  return async (reference, cwd) => {
    const snapshot = await nativeSidebarAdapter.read();
    return snapshot.projects.some(project => project.key === reference.key
      && project.id === reference.id && project.source === reference.source
      && project.hostId === reference.hostId && project.hostId === 'local'
      && project.sourceDirectories.includes(cwd));
  };
}
