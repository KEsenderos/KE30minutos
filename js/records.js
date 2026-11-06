// KE30minutos  records.js  版 0.5  基づく仕様書：KE30minutos_仕様書_v0.5.md
// 役割：記録の「日付・完走・連続日数・月の集計・入力の確認」だけを行う部分（画面や保存を使わない）。（下の Records が保存と読み出しを行う）。
const RecordsCore = {
  pad2_(n) { return n < 10 ? '0' + n : '' + n; },
  // 1日の区切り（startHour 時より前は前の日）で 'YYYY-MM-DD' を返す。ms は時刻（ミリ秒）
  dayStr(ms, startHour) {
    const d = new Date(ms - startHour * 3600000);
    return d.getFullYear() + '-' + this.pad2_(d.getMonth() + 1) + '-' + this.pad2_(d.getDate());
  },
  addDays(dateStr, n) {
    const p = dateStr.split('-').map(Number);
    const t = new Date(p[0], p[1] - 1, p[2] + n);
    return t.getFullYear() + '-' + this.pad2_(t.getMonth() + 1) + '-' + this.pad2_(t.getDate());
  },
  isValidDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const p = s.split('-').map(Number);
    const t = new Date(p[0], p[1] - 1, p[2]);
    return t.getFullYear() === p[0] && t.getMonth() === p[1] - 1 && t.getDate() === p[2];
  },
  // 完走：実際に聞いた秒数が、指定時間（秒）以上
  isCompleted(playSec, targetSec) { return playSec >= targetSec; },
  doneDates(records) { const s = new Set(); for (const r of records) if (r.completed) s.add(r.date); return s; },
  // 連続完走日数：今日が完走していれば今日から、まだなら昨日から数える
  streakDays(records, today) {
    const s = this.doneDates(records);
    let d = s.has(today) ? today : this.addDays(today, -1);
    let n = 0;
    while (s.has(d)) { n++; d = this.addDays(d, -1); }
    return n;
  },
  // 月の集計（m は 1〜12）
  monthSummary(records, y, m) {
    const prefix = y + '-' + this.pad2_(m) + '-';
    const done = new Set(); const played = new Set(); let total = 0;
    for (const r of records) {
      if (r.date.indexOf(prefix) !== 0) continue;
      total += r.playSec; played.add(r.date);
      if (r.completed) done.add(r.date);
    }
    return { doneDays: done.size, playedDays: played.size, totalSec: total };
  },
  // その日の状態：'done'（完走した記録がある）／'played'（記録はあるが完走なし）／''（記録なし）
  dayState(records, dateStr) {
    let st = '';
    for (const r of records) { if (r.date !== dateStr) continue; if (r.completed) return 'done'; st = 'played'; }
    return st;
  },
  // 表示用の時間：「3時間20分」「1時間05分」「45分」
  formatDuration(sec) {
    const mins = Math.round(sec / 60); const h = Math.floor(mins / 60); const m = mins % 60;
    return h > 0 ? h + '時間' + this.pad2_(m) + '分' : m + '分';
  },
  // 再生時間（分）の入力から秒へ。分が変わっていなければ元の秒を残す
  playSecFromInput(inputMin, originalSec) {
    return (originalSec != null && Math.round(originalSec / 60) === inputMin) ? originalSec : inputMin * 60;
  },
  // 修正フォームの確認。誤りのある欄の名前の配列を返す（空なら問題なし）。f: { date, targetMin, playMin }
  validateForm(f, todayStr) {
    const bad = [];
    if (!this.isValidDate(f.date) || f.date > todayStr) bad.push('date');
    if (!Number.isInteger(f.targetMin) || f.targetMin < 5 || f.targetMin > 120) bad.push('target');
    if (!Number.isInteger(f.playMin) || f.playMin < 1 || f.playMin > 600) bad.push('play');
    return bad;
  },
};
if (typeof module !== 'undefined') module.exports = { RecordsCore };

// 記録の保存と読み出し（仕様書 第7-1・11-11節）
const Records = {
  list_: [],

  async refresh() {
    const all = await Store.getAllRecords();
    this.list_ = all.map((r) => this.normalize_(r)).filter(Boolean);
    return this.list_;
  },
  getAll() { return this.list_; },

  // 保存前・読み込み時の確認。正しい日付でないものは捨てる（null）
  normalize_(r) {
    if (!r || typeof r !== 'object' || typeof r.recordId !== 'string' || !r.recordId) return null;
    if (!RecordsCore.isValidDate(r.date)) return null;
    const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
    const created = num(r.createdAt, 0);
    return {
      schema: KE.RECORD_SCHEMA, recordId: r.recordId, date: r.date,
      startedAt: num(r.startedAt, 0),
      playSec: Math.round(Util.clamp(num(r.playSec, 0), 0, KE.REC_PLAY_MAX_MIN * 60)),
      targetSec: Math.round(Util.clamp(num(r.targetSec, KE.TARGET_MIN_DEFAULT * 60), 5 * 60, 120 * 60)),
      songCount: Math.max(0, Math.round(num(r.songCount, 0))),
      completed: r.completed === true,
      source: (r.source === 'auto' || r.source === 'recovered' || r.source === 'manual') ? r.source : 'manual',
      edited: r.edited === true,
      createdAt: created, updatedAt: num(r.updatedAt, created),
    };
  },

  // 追加。件数が上限なら KeError('REC_FULL')。戻り値は保存した記録
  async add(partial) {
    if (this.list_.length >= KE.RECORDS_MAX) throw new KeError('REC_FULL', { max: KE.RECORDS_MAX });
    const now = Date.now();
    const rec = this.normalize_(Object.assign({
      recordId: Util.makeRecordId(), createdAt: now, updatedAt: now, edited: false,
    }, partial));
    if (!rec) throw new KeError('DB');
    await Store.putRecord(rec);
    this.list_.push(rec);
    Sync.markDirty();
    return rec;
  },
  // 修正。rec は全項目つきの記録
  async update(rec) {
    const r = this.normalize_(Object.assign({}, rec, { updatedAt: Date.now() }));
    if (!r) throw new KeError('DB');
    await Store.putRecord(r);
    const i = this.list_.findIndex((x) => x.recordId === r.recordId);
    if (i >= 0) this.list_[i] = r; else this.list_.push(r);
    Sync.markDirty();
    return r;
  },
  // 削除（記録の削除と削除の印を1回の書き込みで）
  async remove(recordId) {
    try { await Store.deleteRecord(recordId); } catch (e) { throw Store.toKeError(e); }
    this.list_ = this.list_.filter((x) => x.recordId !== recordId);
    Sync.markDirty();
  },
};
