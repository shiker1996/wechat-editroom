const SOURCE_TYPES = new Set(['conversation', 'reading', 'life', 'project', 'text']);

function jsonValue(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') { try { return JSON.parse(value); } catch { return fallback; } }
  return value;
}

function now() { return new Date().toISOString(); }

function dateValue(value) {
  const text = String(value ?? '').trim();
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`;
  if (/^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/.test(text)) return text.replace(/[./]/g, '-').replace(/-(\d)(?!\d)/g, '-0$1');
  return text;
}

// 素材聚合的独立 SQL 实现。ContentPlanningRepository 只保留简报/计划关联素材
// 的存在性校验，不再持有素材 CRUD 和评估写入实现。
export class MaterialRepository {
  constructor(db) {
    this.db = db;
  }

  createMaterial({ sourceType = 'text', title = '', rawText, capturedAt = '', tags = [], evidence = [], iteration = {}, nextTeaser = '' } = {}) {
    const normalizedSource = SOURCE_TYPES.has(sourceType) ? sourceType : 'text';
    const text = String(rawText || '').trim();
    if (!text) throw new Error('素材正文不能为空');
    const timestamp = now();
    const result = this.db.prepare(`INSERT INTO writing_materials(source_type,title,raw_text,captured_at,tags_json,evidence_json,iteration_json,next_teaser,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(normalizedSource, String(title || '').trim(), text, dateValue(capturedAt) || timestamp.slice(0, 10), JSON.stringify(tags), JSON.stringify(evidence), JSON.stringify(iteration), String(nextTeaser || '').trim(), timestamp, timestamp);
    return this.getMaterial(Number(result.lastInsertRowid));
  }

  getMaterial(id) {
    const row = this.db.prepare(`SELECT m.*,c.name AS recommended_column_name
      FROM writing_materials m LEFT JOIN content_columns c ON c.id=m.recommended_column_id WHERE m.id=?`).get(Number(id));
    return row ? this.#material(row) : null;
  }

  listMaterials({ status = '', sourceType = '', query = '', limit = 200 } = {}) {
    const where = ['1=1']; const values = [];
    if (status) { where.push('m.status=?'); values.push(status); }
    if (sourceType) { where.push('m.source_type=?'); values.push(sourceType); }
    if (query) { where.push('(m.title LIKE ? OR m.raw_text LIKE ? OR m.tags_json LIKE ?)'); const q = `%${query}%`; values.push(q, q, q); }
    values.push(Math.min(Math.max(Number(limit) || 200, 1), 500));
    return this.db.prepare(`SELECT m.*,c.name AS recommended_column_name FROM writing_materials m
      LEFT JOIN content_columns c ON c.id=m.recommended_column_id WHERE ${where.join(' AND ')} ORDER BY m.updated_at DESC,m.id DESC LIMIT ?`).all(...values).map((row) => this.#material(row));
  }

  updateMaterial(id, input = {}) {
    const current = this.getMaterial(id); if (!current) return null;
    const fields = []; const values = [];
    const assign = (column, value) => { fields.push(`${column}=?`); values.push(value); };
    if (input.title !== undefined) assign('title', String(input.title || '').trim());
    if (input.rawText !== undefined) { const text = String(input.rawText || '').trim(); if (!text) throw new Error('素材正文不能为空'); assign('raw_text', text); }
    if (input.sourceType !== undefined) assign('source_type', SOURCE_TYPES.has(input.sourceType) ? input.sourceType : 'text');
    if (input.capturedAt !== undefined) assign('captured_at', dateValue(input.capturedAt) || new Date().toISOString().slice(0, 10));
    if (input.status !== undefined) assign('status', ['inbox', 'developing', 'planned', 'archived'].includes(input.status) ? input.status : 'inbox');
    if (input.tags !== undefined) assign('tags_json', JSON.stringify(input.tags));
    if (input.evidence !== undefined) assign('evidence_json', JSON.stringify(input.evidence));
    if (input.iteration !== undefined) assign('iteration_json', JSON.stringify(input.iteration));
    if (input.assessment !== undefined) assign('assessment_json', JSON.stringify(input.assessment));
    if (input.recommendedColumnId !== undefined) assign('recommended_column_id', input.recommendedColumnId || null);
    if (input.nextTeaser !== undefined) assign('next_teaser', String(input.nextTeaser || '').trim());
    if (!fields.length) return current;
    assign('updated_at', now()); values.push(Number(id));
    this.db.prepare(`UPDATE writing_materials SET ${fields.join(',')} WHERE id=?`).run(...values);
    return this.getMaterial(id);
  }

  saveAssessment(id, assessment) {
    const payload = { ...assessment, assessed_at: now() };
    return this.updateMaterial(id, { assessment: payload, recommendedColumnId: assessment.recommended_column_id || null });
  }

  #material(row) {
    return {
      ...row,
      tags: jsonValue(row.tags_json, []),
      evidence: jsonValue(row.evidence_json, []),
      iteration: jsonValue(row.iteration_json, {}),
      assessment: jsonValue(row.assessment_json, {}),
      recommended_column_id: row.recommended_column_id ? Number(row.recommended_column_id) : null,
    };
  }
}
