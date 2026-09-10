import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../server/platform/core/config.mjs';
import { resolveRuntimePaths } from '../server/platform/core/runtime-paths.mjs';
import { SkillRegistry } from '../server/platform/skills/registry.mjs';
import { loadSkillBundle, resolveSkillFile } from '../server/platform/llm/skill-runtime.mjs';

test('桌面运行时可将配置和工作区放在应用资源目录之外', () => {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-app-'));
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-config-'));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-workspace-'));
  try {
    fs.writeFileSync(path.join(configRoot, 'config.local.json'), JSON.stringify({
      workspaceRoot: '.',
      rsshub: { rootDir: 'rsshub' },
    }), 'utf8');
    const paths = resolveRuntimePaths({ appRoot, configRoot, workspaceRoot });
    const config = loadConfig(appRoot, { configRoot: paths.configRoot, workspaceRoot: paths.workspaceRoot });
    assert.equal(paths.appRoot, path.resolve(appRoot));
    assert.equal(paths.configRoot, path.resolve(configRoot));
    assert.equal(paths.workspaceRoot, path.resolve(workspaceRoot));
    assert.equal(paths.dataRoot, path.join(workspaceRoot, 'data'));
    assert.equal(config.workspaceRoot, path.resolve(workspaceRoot));
    assert.equal(config.rsshub.rootDir, path.join(configRoot, 'rsshub'));
  } finally {
    for (const directory of [appRoot, configRoot, workspaceRoot]) fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('桌面工作区可以写入本地覆盖，但内置技能仍从资源目录加载', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-workspace-'));
  try {
    const registry = new SkillRegistry({ workspaceRoot, resourceRoot: process.cwd() });
    const skill = registry.get('wechat-mp-tech-hotspot');
    assert.ok(skill, '应能从资源目录发现内置技能');
    assert.equal(skill.enabled, true);

    const bundle = loadSkillBundle({ workspaceRoot, skillName: 'wechat-mp-tech-hotspot' });
    assert.equal(bundle.fallback, false);
    assert.ok(bundle.files.some((file) => file.endsWith(path.join('skills', 'wechat-mp-tech-hotspot', 'SKILL.md'))));
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('打包运行时技能可执行文件从资源目录解析，不拼到用户工作区', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-workspace-'));
  const resourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-resource-'));
  const previous = process.env.WORKBENCH_RESOURCE_ROOT;
  try {
    const entry = path.join(resourceRoot, 'skills', 'html-pages-to-images', 'index.js');
    fs.mkdirSync(path.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, '// packaged skill entry', 'utf8');
    process.env.WORKBENCH_RESOURCE_ROOT = resourceRoot;
    assert.equal(resolveSkillFile({ workspaceRoot, skillName: 'html-pages-to-images' }), entry);
  } finally {
    if (previous == null) delete process.env.WORKBENCH_RESOURCE_ROOT;
    else process.env.WORKBENCH_RESOURCE_ROOT = previous;
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    fs.rmSync(resourceRoot, { recursive: true, force: true });
  }
});
