/**
 * 跨垂直层可使用的模型 JSON 边界。
 *
 * 这个模块不依赖 platform 或业务 feature；platform/llm 的完整解析器仍负责
 * 工具请求专用的尾部修复。共享主题只需要这里的围栏剥离、主对象定位和稳定
 * 错误码，因此不会反向穿透架构边界。
 */

export const MODEL_JSON_ERROR_CODES = Object.freeze({
  TRUNCATED: 'MODEL_JSON_TRUNCATED',
  INVALID: 'MODEL_JSON_INVALID',
});

export class ModelJsonError extends Error {
  constructor(code, message, { cause, raw = '' } = {}) {
    super(message, { cause });
    this.name = 'ModelJsonError';
    this.code = code;
    this.raw = raw;
  }
}

export function stripJsonFence(value) {
  return String(value ?? '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

export function locateJsonValue(value) {
  const text = stripJsonFence(value);
  for (let start = 0; start < text.length; start += 1) {
    if (!'{['.includes(text[start])) continue;
    const stack = [];
    let quoted = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') { quoted = true; continue; }
      if (char === '{' || char === '[') stack.push(char);
      else if (char === '}' || char === ']') {
        const open = stack.pop();
        if ((open === '{' && char !== '}') || (open === '[' && char !== ']')) break;
        if (!stack.length) return { text: text.slice(start, index + 1), truncated: false };
      }
    }
    if (stack.length || quoted) return { text: text.slice(start), truncated: true };
  }
  return { text, truncated: false };
}

export function parseJsonText(value) {
  return JSON.parse(stripJsonFence(value));
}

export function parseModelJson(result, { label = '模型' } = {}) {
  const raw = String(result?.content ?? result ?? '');
  const located = locateJsonValue(raw);
  try {
    if (located.truncated || !located.text || result?.finishReason === 'length' || result?.finish_reason === 'length') {
      throw new ModelJsonError(MODEL_JSON_ERROR_CODES.TRUNCATED, `${label}输出达到上限，JSON 被截断或结构未闭合`, { raw });
    }
    const parsed = JSON.parse(located.text);
    if (!parsed || typeof parsed !== 'object') throw new Error('顶层必须是对象或数组');
    return parsed;
  } catch (error) {
    if (error instanceof ModelJsonError) throw error;
    throw new ModelJsonError(MODEL_JSON_ERROR_CODES.INVALID, `${label}返回无效 JSON：${error.message}`, { cause: error, raw });
  }
}
