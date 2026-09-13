// 素材业务垂直入口。
// 公开能力清单保持稳定；素材领域规则和用例编排已迁入 domain/application，
// HTTP 与持久化通过平台适配层接入。
export const MATERIALS_CAPABILITIES = Object.freeze([
  'capture',
  'query',
  'edit',
  'status-transition',
  'assessment',
]);

export { assessMaterial } from './domain/material-assessment.mjs';
export { createMaterialService } from './application/material-service.mjs';
