// KE30minutos  backup.js  版 0.4.1  基づく仕様書：KE30minutos_仕様書_v0.4.1.md
// 役割：記録と曲の設定のバックアップの書き出し・読み込み、案内（仕様書 第11-12節）。曲のファイルは入れない。GASのURL・合言葉も入れない
const Backup = {
  fileName_() { return 'ke30minutos-backup-' + RecordsCore.dayStr(Date.now(), 0) + '.json'; },

  async exportAll() {
    let json;
    try {
      const songs = (await Store.getAllSongs()).map((s) => ({
        songId: s.songId, name: s.name, size: s.size, durationSec: s.durationSec,
        pitch: s.pitch, speed: s.speed, paramsAt: s.paramsAt, inMain: s.inMain, inLast: s.inLast,
      }));
      const records = await Store.getAllRecords();
      json = JSON.stringify({
        app: 'KE30minutos', schema: 1, appVersion: KE.APP_VERSION,
        exportedAt: new Date().toISOString(), records, songs,
      });
    } catch (e) { UI.showError(Store.toKeError(e)); return; }
    const file = new File([json], this.fileName_(), { type: 'application/json' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'KE30minutos バックアップ' });
      } else {
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url; a.download = file.name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;       // 共有の画面を閉じた：何も表示せず、記録も変えない
      UI.showMessage(Util.fill(TEXT.ERR_BACKUP_FILE, { detail: String(e && e.message || e).slice(0, 60) }), 'error');
      return;
    }
    Util.lsSet(KE.LS.LAST_BACKUP, Date.now());
    UI.showMessage(TEXT.INFO_BACKUP_EXPORTED, 'info');
    UI.renderBackup();
    UI.renderBackupWarn();
  },

  // 読み込み（再生していないときだけ）
  async importFile(file) {
    if (Library.isBusy_()) return;
    const bad = (detail) => { UI.setBackupResult(Util.fill(TEXT.ERR_BACKUP_FILE, { detail }), 'error'); };
    if (file.size > KE.BACKUP_MAX_BYTES) { UI.setBackupResult(Util.fill(TEXT.ERR_BACKUP_BIG, { max: KE.BACKUP_MAX_BYTES / 1024 / 1024 }), 'error'); return; }
    let o;
    try { o = JSON.parse(await file.text()); } catch (e) { bad('JSON'); return; }
    if (!o || o.app !== 'KE30minutos') { bad('app'); return; }
    if (o.schema !== 1) { bad('schema'); return; }
    if (!Array.isArray(o.records) || !Array.isArray(o.songs)) { bad('records/songs'); return; }
    // ここまでは何も変えない。ここから追加
    let skip = 0;
    const have = new Set(Records.getAll().map((r) => r.recordId));
    let removedMap;
    try {
      removedMap = new Map((await Store.getAllRemoved()).map((x) => [x.recordId, x.deletedAt]));
    } catch (e) { UI.showError(Store.toKeError(e)); return; }
    const recs = [];
    let room = KE.RECORDS_MAX - Records.getAll().length;
    for (const raw of o.records) {
      const r = Records.normalize_(raw);
      if (!r) { skip++; continue; }
      if (have.has(r.recordId)) { skip++; continue; }
      const d = removedMap.get(r.recordId);
      if (d !== undefined && d >= r.updatedAt) { skip++; continue; }
      if (room <= 0) { skip++; continue; }
      room--; have.add(r.recordId); recs.push(r);
    }
    const songs = [];
    for (const raw of o.songs) {
      if (!raw || typeof raw.songId !== 'string' || !raw.songId) { skip++; continue; }
      songs.push({
        songId: raw.songId, name: typeof raw.name === 'string' ? raw.name : raw.songId, size: Number(raw.size) || 0,
        durationSec: Number(raw.durationSec) || 0,
        pitch: Math.round(Util.clamp(Number(raw.pitch) || 0, KE.PITCH_MIN, KE.PITCH_MAX)),
        speed: Util.clamp(Util.roundStep(Number(raw.speed) || 1, KE.SPEED_STEP), KE.SPEED_MIN, KE.SPEED_MAX),
        paramsAt: Number(raw.paramsAt) || 0,
      });
    }
    let addedR = 0;
    let addedS = 0;
    try {
      addedR = await Store.putRecordsIfAbsent(recs);
      addedS = await Store.putSongSettingsIfAbsent(songs);
    } catch (e) { UI.showError(Store.toKeError(e)); return; }
    skip += (recs.length - addedR) + (songs.length - addedS);
    await Records.refresh();
    await Library.refresh();
    if (addedR + addedS > 0) { Sync.markDirty(); Sync.request('change'); }
    UI.setBackupResult(Util.fill(TEXT.INFO_BACKUP_IMPORTED, { r: addedR, s: addedS, skip }), 'info');
    UI.render();
  },

  // 案内：記録が一定数以上あり、最後の保存（書き出し・同期の新しい方）が無い／古いとき
  warnState_() {
    if (Records.getAll().length < KE.BACKUP_WARN_MIN_RECORDS) return null;
    const last = Math.max(Util.lsGetNum(KE.LS.LAST_BACKUP, 0), Util.lsGetNum(KE.LS.LAST_SYNC, 0));
    if (!last) return TEXT.WARN_BACKUP_NEVER;
    const days = Math.floor((Date.now() - last) / 86400000);
    if (days >= KE.BACKUP_WARN_DAYS) return Util.fill(TEXT.WARN_BACKUP, { days });
    return null;
  },
};
