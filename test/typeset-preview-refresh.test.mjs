import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const editor = fs.readFileSync(new URL("../public/src/views/editor.js", import.meta.url), "utf8");
const preview = fs.readFileSync(new URL("../public/src/views/preview.js", import.meta.url), "utf8");
const mediaRoutes = fs.readFileSync(new URL("../server/platform/http/routes/media-routes.mjs", import.meta.url), "utf8");

test("排版任务完成后主动刷新产物并加载最新 HTML", () => {
  assert.match(editor, /job\.status === "completed" && job\.type === "typeset"[\s\S]*dispatchEvent\(new CustomEvent\("typeset:completed"/);
  assert.match(preview, /addEventListener\("typeset:completed"[\s\S]*loadProductionPreview\(\)/);
  assert.match(preview, /const prevId = document\.getElementById\("typeset-candidate"\)\?\.value/);
  assert.match(preview, /preview=phone&v=' \+ encodeURIComponent\(htmlArtifact\.modified_at\)/);
});

test("排版默认使用当前模型配置，不复用历史快照", () => {
  assert.match(mediaRoutes, /const reusePreviousSnapshot=input\.reuseSnapshot===true\|\|input\.useLatestSkill===false/);
  assert.match(mediaRoutes, /const previousSnapshot=reusePreviousSnapshot\?store\.findLatestGenerationSnapshot/);
});
