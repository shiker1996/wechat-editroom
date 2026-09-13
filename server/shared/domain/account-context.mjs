/**
 * 兼容入口：账号上下文领域模型。
 * 文件读写和缓存请从 platform/application/account-context-service.mjs 引入。
 */
export {
  formatAccountContext,
  getDefaultAccountContext,
  isAccountContextConfigured,
  normalizeAccountPatch,
} from './account-context-model.mjs';
