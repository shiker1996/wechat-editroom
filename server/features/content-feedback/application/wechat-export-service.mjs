import fs from 'node:fs';
import { parseWechatExport } from '../domain/wechat-export-parser.mjs';

// 文件 I/O 由 application 承载，字节解析规则位于 content-feedback/domain。
export { parseWechatExport };

export function parseWechatExportFile(filePath) {
  return parseWechatExport(fs.readFileSync(filePath), filePath);
}
