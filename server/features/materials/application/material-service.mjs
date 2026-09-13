import { assessMaterial } from '../domain/material-assessment.mjs';

// 素材用例编排。Repository、栏目查询和评估上下文均由启动装配注入，
// 业务垂直不反向依赖 platform 实现。
export function createMaterialService({ repository } = {}) {
  if (!repository) throw new Error('素材服务缺少 Repository');

  const assessment = (material, context = {}) => assessMaterial(
    material,
    Array.isArray(context.columns) ? context.columns : [],
    context.accountContext || {},
    context.historicalSignal || {},
  );

  return Object.freeze({
    create(input = {}) {
      return repository.createMaterial(input);
    },
    capture(input = {}, context = {}) {
      const material = repository.createMaterial(input);
      return repository.saveAssessment(material.id, assessment(material, context));
    },
    get(id) {
      return repository.getMaterial(id);
    },
    list(input = {}) {
      return repository.listMaterials(input);
    },
    update(id, input = {}) {
      return repository.updateMaterial(id, input);
    },
    saveAssessment(id, value) {
      return repository.saveAssessment(id, value);
    },
    reassess(id, context = {}) {
      const material = repository.getMaterial(id);
      if (!material) return null;
      return repository.saveAssessment(material.id, assessment(material, context));
    },
  });
}
