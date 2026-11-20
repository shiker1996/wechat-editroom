import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const VERSION_FILE = '.jianzi-skill-source.json';
const TARGETS = [
  { agent: 'codex', relativePath: path.join('.agents', 'skills') },
  { agent: 'workbuddy', relativePath: path.join('.codebuddy', 'skills') },
];

function skillFiles(directory, root = directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return skillFiles(absolutePath, root);
      if (!entry.isFile() || entry.name === VERSION_FILE) return [];
      return [{ absolutePath, relativePath: path.relative(root, absolutePath).split(path.sep).join('/') }];
    });
}

function directoryHash(directory) {
  if (!fs.existsSync(directory)) return '';
  const hash = crypto.createHash('sha256');
  for (const file of skillFiles(directory)) {
    hash.update(file.relativePath);
    hash.update('\0');
    hash.update(fs.readFileSync(file.absolutePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function sourceSkills(projectRoot) {
  const sourceRoot = path.join(projectRoot, 'agent-integrations', 'skills');
  if (!fs.existsSync(sourceRoot)) return [];
  const packagePath = path.join(projectRoot, 'package.json');
  const projectVersion = fs.existsSync(packagePath) ? JSON.parse(fs.readFileSync(packagePath, 'utf8')).version || '' : '';
  return fs.readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const directory = path.join(sourceRoot, entry.name);
      return { name: entry.name, directory, projectVersion, sourceHash: directoryHash(directory) };
    });
}

export function inspectInstalledSkillCopies(projectRoot) {
  const sources = sourceSkills(projectRoot);
  const targets = [];
  for (const target of TARGETS) {
    const targetRoot = path.join(projectRoot, target.relativePath);
    if (!fs.existsSync(targetRoot)) continue;
    const skills = sources.map((source) => {
      const installedDirectory = path.join(targetRoot, source.name);
      const versionPath = path.join(installedDirectory, VERSION_FILE);
      let installedVersion = null;
      try { installedVersion = JSON.parse(fs.readFileSync(versionPath, 'utf8')); } catch {}
      const installedHash = directoryHash(installedDirectory);
      const versionMatch = installedVersion?.projectVersion === source.projectVersion;
      const hashMatch = installedHash === source.sourceHash && installedVersion?.sourceHash === source.sourceHash;
      const current = versionMatch && hashMatch;
      return {
        name: source.name,
        status: current ? 'current' : 'stale',
        versionMatch,
        hashMatch,
        projectVersion: source.projectVersion,
        installedProjectVersion: installedVersion?.projectVersion || null,
        sourceHash: source.sourceHash,
        installedHash: installedHash || null,
      };
    });
    targets.push({ agent: target.agent, targetRoot, status: skills.every((skill) => skill.status === 'current') ? 'current' : 'stale', skills });
  }
  return {
    status: targets.length === 0 ? 'not_installed' : targets.every((target) => target.status === 'current') ? 'current' : 'stale',
    sourceRoot: path.join(projectRoot, 'agent-integrations', 'skills'),
    checkedTargets: targets.length,
    targets,
  };
}

export function syncInstalledSkillCopies(projectRoot, { targetRoots = null } = {}) {
  const sources = sourceSkills(projectRoot);
  const roots = targetRoots?.length
    ? targetRoots
    : TARGETS.map((target) => path.join(projectRoot, target.relativePath)).filter((targetRoot) => fs.existsSync(targetRoot));
  const installed = [];
  for (const targetRoot of roots) {
    fs.mkdirSync(targetRoot, { recursive: true });
    for (const source of sources) {
      const targetDirectory = path.join(targetRoot, source.name);
      fs.rmSync(targetDirectory, { recursive: true, force: true });
      fs.cpSync(source.directory, targetDirectory, { recursive: true });
      fs.writeFileSync(path.join(targetDirectory, VERSION_FILE), `${JSON.stringify({ schemaVersion: 1, projectVersion: source.projectVersion, sourceHash: source.sourceHash }, null, 2)}\n`, 'utf8');
      installed.push({ name: source.name, targetDirectory, projectVersion: source.projectVersion, sourceHash: source.sourceHash });
    }
  }
  return { status: 'synced', installed };
}
