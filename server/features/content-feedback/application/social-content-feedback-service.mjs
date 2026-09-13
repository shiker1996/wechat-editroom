import fs from 'node:fs';
import path from 'node:path';
import {
  buildSocialContentFeedbackSnapshot as buildSocialContentFeedbackDomainSnapshot,
  extractSocialContentFeatures as extractSocialContentFeaturesFromSources,
} from '../domain/social-content-feedback.mjs';

function readText(filePath, maxChars = 160000) {
  try { return fs.readFileSync(filePath, 'utf8').slice(0, maxChars); } catch { return ''; }
}

function readJson(filePath) {
  try { return JSON.parse(readText(filePath, 600000)); } catch { return null; }
}

function directoryFor(filePath) {
  if (!filePath) return '';
  try { return fs.statSync(filePath).isDirectory() ? filePath : path.dirname(filePath); } catch { return path.dirname(filePath); }
}

function loadSocialContentSources(filePath) {
  const directory = directoryFor(filePath);
  if (!directory) return { directory: '', copyContent: '', cardPlan: null, layoutReport: null, stageExecutions: null };
  return {
    directory,
    copyContent: readText(path.join(directory, 'copy.txt')),
    cardPlan: readJson(path.join(directory, 'card-plan.json')) || readJson(path.join(directory, 'card-plan-original.json')),
    layoutReport: readJson(path.join(directory, 'layout-report.json')),
    stageExecutions: readJson(path.join(directory, 'social-card-stage-executions.json')),
  };
}

export function extractSocialContentFeatures(row = {}) {
  return extractSocialContentFeaturesFromSources(row, { sources: loadSocialContentSources(row.file_path || '') });
}

export function buildSocialContentFeedbackSnapshot(rows = []) {
  const hydratedRows = (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    social_content_sources: loadSocialContentSources(row?.file_path || ''),
  }));
  return buildSocialContentFeedbackDomainSnapshot(hydratedRows);
}

export { loadSocialContentSources };
