import crypto from 'node:crypto';

const shanghaiClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function localTimeOf(date) {
  return shanghaiClock.format(date);
}

export class BatchRepository {
  constructor(db) { this.db = db; }

  create({ date, title, note = '', batchType = 'regular', requestedTracks = ['article'] }) {
    const now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const dailySequence = this.reserveDailySequence(date);
      const safeTitle = String(title ?? '').trim();
      const finalTitle = safeTitle || `${date} ${localTimeOf(new Date(now))} · 每日选题 #${String(dailySequence).padStart(2, '0')}`;
    const insert=this.db.prepare(`INSERT INTO batches
      (id, batch_date, title, batch_type, requested_tracks, status, stage, note, daily_sequence, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'draft', 'collect', ?, ?, ?, ?)`);
      for(let attempt=0;attempt<5;attempt+=1){
        const id=`${date}-${crypto.randomBytes(5).toString('hex')}`;
        try{
          insert.run(id,date,finalTitle,batchType,JSON.stringify(requestedTracks),note,dailySequence,now,now);
          this.db.exec('COMMIT');
          return id;
        }catch(error){if(!String(error.message).includes('UNIQUE'))throw error;}
      }
      throw new Error('批次 ID 生成冲突，请重试');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  reserveDailySequence(date) {
    const row=this.db.prepare('SELECT next_sequence FROM batch_daily_sequences WHERE batch_date=?').get(date);
    if(row){
      const sequence=Number(row.next_sequence);
      this.db.prepare('UPDATE batch_daily_sequences SET next_sequence=? WHERE batch_date=?').run(sequence+1,date);
      return sequence;
    }
    const max=Number(this.db.prepare('SELECT COALESCE(MAX(daily_sequence),0) AS max_sequence FROM batches WHERE batch_date=?').get(date)?.max_sequence||0);
    const sequence=max+1;
    this.db.prepare('INSERT INTO batch_daily_sequences(batch_date,next_sequence) VALUES(?,?)').run(date,sequence+1);
    return sequence;
  }

  list(limit = 60) {
    return this.db.prepare(`SELECT b.*,
      (SELECT COUNT(*) FROM hotspots h WHERE h.batch_id=b.id) AS hotspot_count,
      (SELECT COUNT(*) FROM artifacts a WHERE a.batch_id=b.id) AS artifact_count
      FROM batches b ORDER BY batch_date DESC, created_at DESC LIMIT ?`).all(limit);
  }

  latestActive(preferredId = null) {
    if (preferredId) {
      const preferred = this.db.prepare(`SELECT b.*,
        (SELECT COUNT(*) FROM hotspots h WHERE h.batch_id=b.id) AS hotspot_count,
        (SELECT COUNT(*) FROM artifacts a WHERE a.batch_id=b.id) AS artifact_count
        FROM batches b WHERE b.id=? AND b.lifecycle_status='active'`).get(preferredId);
      if (preferred) return preferred;
    }
    return this.db.prepare(`SELECT b.*,
      (SELECT COUNT(*) FROM hotspots h WHERE h.batch_id=b.id) AS hotspot_count,
      (SELECT COUNT(*) FROM artifacts a WHERE a.batch_id=b.id) AS artifact_count
      FROM batches b WHERE b.lifecycle_status='active'
      ORDER BY batch_date DESC, created_at DESC LIMIT 1`).get() ?? null;
  }

  update(id, fields) {
    const allowed = ['title', 'status', 'lifecycle_status', 'stage', 'note', 'max_age_hours'];
    const entries = Object.entries(fields).filter(([key]) => allowed.includes(key));
    if (!entries.length) return false;
    entries.push(['updated_at', new Date().toISOString()]);
    this.db.prepare(`UPDATE batches SET ${entries.map(([key]) => `${key}=?`).join(', ')} WHERE id=?`)
      .run(...entries.map(([, value]) => value), id);
    return true;
  }

  deleteCounts(batchId) {
    const count = (sql) => this.db.prepare(sql).get(batchId)?.n ?? 0;
    return {
      hotspots: count('SELECT COUNT(*) AS n FROM hotspots WHERE batch_id=?'),
      candidates: count('SELECT COUNT(*) AS n FROM candidates WHERE batch_id=?'),
      documents: count('SELECT COUNT(*) AS n FROM documents WHERE batch_id=?'),
      sourceRuns: count('SELECT COUNT(*) AS n FROM source_runs WHERE batch_id=?'),
      subscriptionRuns: count('SELECT COUNT(*) AS n FROM subscription_runs WHERE batch_id=?'),
      modelCalls: count('SELECT COUNT(*) AS n FROM model_calls WHERE batch_id=?'),
      aiRuns: count('SELECT COUNT(*) AS n FROM ai_runs WHERE batch_id=?'),
      artifacts: count('SELECT COUNT(*) AS n FROM artifacts WHERE batch_id=?'),
    };
  }

  delete(id) { return this.db.prepare('DELETE FROM batches WHERE id=?').run(id).changes > 0; }
}
