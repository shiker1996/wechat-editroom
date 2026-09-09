import path from 'node:path';

// Packaged desktop builds have a read-only resource directory and a separate
// writable workspace. Source checkouts keep both roots identical by default.
export function resolveRuntimePaths({ appRoot, configRoot, workspaceRoot } = {}) {
  const resolvedAppRoot = path.resolve(appRoot || process.cwd());
  const resolvedConfigRoot = path.resolve(configRoot || resolvedAppRoot);
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot || resolvedConfigRoot);
  return Object.freeze({
    appRoot: resolvedAppRoot,
    configRoot: resolvedConfigRoot,
    workspaceRoot: resolvedWorkspaceRoot,
    dataRoot: path.join(resolvedWorkspaceRoot, 'data'),
  });
}
