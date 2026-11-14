import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { archivePreviousImageRun } from '../server/features/articles/application/article-image-pipeline.mjs';

test('显式从占位重跑时归档当前图片、资产清单和检查点', () => {
  const workdir=fs.mkdtempSync(path.join(os.tmpdir(),'article-image-restart-'));
  try {
    fs.mkdirSync(path.join(workdir,'images'),{recursive:true});
    fs.writeFileSync(path.join(workdir,'images','source-01.png'),'image');
    fs.writeFileSync(path.join(workdir,'image-assets.json'),'{}');
    fs.writeFileSync(path.join(workdir,'article-image-pipeline.json'),'{}');
    const archive=archivePreviousImageRun(workdir);
    assert.ok(archive);
    assert.equal(fs.readFileSync(path.join(archive,'images','source-01.png'),'utf8'),'image');
    assert.equal(fs.existsSync(path.join(archive,'image-assets.json')),true);
    assert.equal(fs.existsSync(path.join(archive,'article-image-pipeline.json')),true);
    assert.equal(fs.existsSync(path.join(workdir,'images')),false);
    assert.equal(fs.existsSync(path.join(workdir,'image-assets.json')),false);
    assert.equal(fs.existsSync(path.join(workdir,'article-image-pipeline.json')),false);
  } finally { fs.rmSync(workdir,{recursive:true,force:true}); }
});
