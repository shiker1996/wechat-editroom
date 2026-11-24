import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const write = args.includes('--write');
const fileIndex = args.indexOf('--file');
const filePath = path.resolve(fileIndex >= 0 ? args[fileIndex + 1] : 'account-context.json');
if (fileIndex >= 0 && !args[fileIndex + 1]) throw new Error('--file requires a path');
if (!fs.existsSync(filePath)) throw new Error(`Account context not found: ${filePath}`);

const context = JSON.parse(fs.readFileSync(filePath, 'utf8'));
if (!context || typeof context !== 'object' || Array.isArray(context)) throw new Error('Account context must be a JSON object');
const current = context.scoring && typeof context.scoring === 'object' ? context.scoring : {};
const v2HBase = { worker_social: 48, bigtech: 33, owned_experience: 35, controversial_return: 30,
  key_person_move: 33, ai_tool_test: 20, financing: 10, career_anxiety: 5, contrarian_bigtech: 35 };
const v4AccountFit = {
  '大厂与商业战略': 85,
  '职场与组织变化': 85,
  '开源项目与开发者生态': 75,
  '产品与技术动态': 65,
  '行业趋势与市场变化': 55,
  '政策与公共议题': 20,
};
const v4CategoryPreference = {
  '大厂与商业战略': 4,
  '职场与组织变化': 5,
  '开源项目与开发者生态': 7,
  '产品与技术动态': 5,
  '行业趋势与市场变化': 2,
  '政策与公共议题': 0,
};
const v4DomesticPreference = { '大厂与商业战略': 8, '职场与组织变化': 6, '产品与技术动态': 6 };
const legacyV2 = current.legacyV2 || {
  weights: current.weights || { h: 0.6, b: 0.25, p: 0.15 },
  eventValueWeight: current.eventValueWeight ?? 0.25,
  researchValueWeight: current.researchValueWeight ?? 0.20,
  hBase: current.hBase || v2HBase,
  accountFit: current.accountFit || {},
  categoryPreference: current.categoryPreference || {},
  marketScopeCategoryPreference: current.marketScopeCategoryPreference || {},
};
const next = {
  ...context,
  scoring: {
    ...current,
    formulaVersion: 'v4',
    legacyV2,
    weights: { h: 0.50, b: 0.30, p: 0.20 },
    eventValueWeight: 0.20,
    researchValueWeight: 0.10,
    domesticWeight: 0.10,
    accountFit: { ...(current.accountFit || {}), ...v4AccountFit },
    categoryPreference: { ...(current.categoryPreference || {}), ...v4CategoryPreference },
    marketScopeCategoryPreference: {
      ...(current.marketScopeCategoryPreference || {}),
      国内: { ...(current.marketScopeCategoryPreference?.国内 || {}), ...v4DomesticPreference },
    },
    hBase: {
      worker_social: 58,
      bigtech: 42,
      owned_experience: 36,
      controversial_return: 35,
      key_person_move: 32,
      github_tool: 10,
      ai_tool_test: 14,
      financing: 3,
      career_anxiety: 50,
      contrarian_bigtech: 35,
    },
  },
};

if (!write) {
  process.stdout.write(`${JSON.stringify({ file: filePath, writeRequired: true, scoring: next.scoring }, null, 2)}\n`);
  process.stdout.write('v4 dry run only. Re-run with --write to create a backup and update this account context.\n');
} else {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.bak-${stamp}`;
  fs.copyFileSync(filePath, backupPath);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
  process.stdout.write(`Updated ${filePath}\nBackup: ${backupPath}\n`);
}
