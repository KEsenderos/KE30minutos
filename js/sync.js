// KE30minutos  sync.js  版 0.4.1  基づく仕様書：KE30minutos_仕様書_v0.4.1.md
// 役割：端末どうし（ドライブの同期ファイル経由）で、記録・曲のキーと速度・再生時間を「足し合わせる」計算だけを行う部分（通信や保存を使わない）。下の Sync が、いつ読み、どう足し、端末とドライブに書くかを受け持つ。
const RC_ = (typeof RecordsCore !== 'undefined') ? RecordsCore : require('./records-core.js').RecordsCore;
const SyncCore = {
  SCHEMA: 1,
  KEEP_DAYS: 180,          // 削除の印を残す日数（KE.SYNC_REMOVED_KEEP_DAYS と同じ値）
  clamp_(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); },
  num_(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; },
  str_(v, max) { return (typeof v === 'string' && v.length > 0 && v.length <= max) ? v : null; },

  // ---- 入力の確認（形が崩れたものは捨てる・範囲に丸める。第7-1節の規則） ----
  normalizeRecord(r) {
    if (!r || typeof r !== 'object') return null;
    const id = this.str_(r.recordId, 80);
    if (!id || !RC_.isValidDate(r.date)) return null;
    const created = this.num_(r.createdAt, 0);
    return {
      schema: 1, recordId: id, date: r.date,
      startedAt: this.num_(r.startedAt, 0),
      playSec: Math.round(this.clamp_(this.num_(r.playSec, 0), 0, 36000)),
      targetSec: Math.round(this.clamp_(this.num_(r.targetSec, 1800), 300, 7200)),
      songCount: Math.round(this.clamp_(this.num_(r.songCount, 0), 0, 1000)),
      completed: r.completed === true,
      source: (r.source === 'auto' || r.source === 'recovered' || r.source === 'manual') ? r.source : 'manual',
      edited: r.edited === true,
      createdAt: created, updatedAt: this.num_(r.updatedAt, created),
    };
  },
  normalizeSong(s) {
    if (!s || typeof s !== 'object') return null;
    const id = this.str_(s.songId, 300);
    if (!id) return null;
    const speed = Math.round(this.clamp_(this.num_(s.speed, 1), 0.85, 1.15) / 0.05) * 0.05;
    return {
      songId: id, name: this.str_(s.name, 300) || id, size: Math.max(0, this.num_(s.size, 0)),
      durationSec: this.clamp_(this.num_(s.durationSec, 0), 0, 36000),
      pitch: Math.round(this.clamp_(this.num_(s.pitch, 0), -3, 3)),
      speed: Number(speed.toFixed(2)),
      paramsAt: Math.max(0, this.num_(s.paramsAt, 0)),
    };
  },
  normalizeSettings(s) {
    s = (s && typeof s === 'object') ? s : {};
    return { targetMin: this.clamp_(Math.round(this.num_(s.targetMin, 30) / 5) * 5, 5, 120), updatedAt: Math.max(0, this.num_(s.updatedAt, 0)) };
  },
  normalizeRemoved(x) {
    if (!x || typeof x !== 'object') return null;
    const id = this.str_(x.recordId, 80);
    return id ? { recordId: id, deletedAt: Math.max(0, this.num_(x.deletedAt, 0)) } : null;
  },
  // ドライブから受け取ったJSON（または端末の内容）を、中身の形にそろえる。別のアプリ・版違い・配列でないものは null
  normalizeDoc(o) {
    if (!o || typeof o !== 'object' || o.app !== 'KE30minutos' || o.schema !== this.SCHEMA) return null;
    if (!Array.isArray(o.records) || !Array.isArray(o.songs) || !Array.isArray(o.removed)) return null;
    return {
      settings: this.normalizeSettings(o.settings),
      songs: o.songs.map(s => this.normalizeSong(s)).filter(Boolean),
      records: o.records.map(r => this.normalizeRecord(r)).filter(Boolean),
      removed: o.removed.map(x => this.normalizeRemoved(x)).filter(Boolean),
    };
  },
  emptyDoc() { return { settings: { targetMin: 30, updatedAt: 0 }, songs: [], records: [], removed: [] }; },

  // ---- 足し合わせ（a と b を入れ替えても同じ結果。もう一度足しても変わらない） ----
  // 同じ項目が両方にあるとき、key の値が大きい（新しい）方を選ぶ。同じなら、文字にしたときに大きい方（どちらから見ても同じ結果にするため）
  newer_(x, y, key) {
    if (x[key] !== y[key]) return x[key] > y[key] ? x : y;
    return JSON.stringify(x) >= JSON.stringify(y) ? x : y;
  },
  byId_(k) { return (p, q) => (p[k] < q[k] ? -1 : p[k] > q[k] ? 1 : 0); },
  merge(a, b, nowMs) {
    const keepMs = this.KEEP_DAYS * 86400000;
    const rm = new Map();   // 削除の印：recordId → 削除した時刻（大きい方）
    for (const x of a.removed.concat(b.removed)) {
      const c = rm.get(x.recordId);
      if (c === undefined || x.deletedAt > c) rm.set(x.recordId, x.deletedAt);
    }
    const rec = new Map();  // 記録：recordId → 新しい方
    for (const r of a.records.concat(b.records)) {
      const c = rec.get(r.recordId);
      rec.set(r.recordId, c ? this.newer_(c, r, 'updatedAt') : r);
    }
    const records = [];     // 削除の印が記録の更新より後（同時を含む）なら、その記録は消す
    for (const r of rec.values()) {
      const d = rm.get(r.recordId);
      if (d !== undefined && d >= r.updatedAt) continue;
      records.push(r);
    }
    const removed = [];     // 古い削除の印は捨てる
    for (const [id, at] of rm) { if (nowMs - at <= keepMs) removed.push({ recordId: id, deletedAt: at }); }
    const sg = new Map();   // 曲のキー・速度：paramsAt の新しい方。長さは、勝った側が0なら負けた側の値
    for (const s of a.songs.concat(b.songs)) {
      const c = sg.get(s.songId);
      if (!c) { sg.set(s.songId, s); continue; }
      const w = this.newer_(c, s, 'paramsAt'), l = (w === c) ? s : c;
      sg.set(s.songId, Object.assign({}, w, { durationSec: w.durationSec > 0 ? w.durationSec : l.durationSec }));
    }
    return {
      settings: this.newer_(a.settings, b.settings, 'updatedAt'),
      songs: Array.from(sg.values()).sort(this.byId_('songId')),
      records: records.sort(this.byId_('recordId')),
      removed: removed.sort(this.byId_('recordId')),
    };
  },
  // 並べ方をそろえた複製（比べるため）
  canon_(d) {
    return { settings: d.settings, songs: d.songs.slice().sort(this.byId_('songId')),
             records: d.records.slice().sort(this.byId_('recordId')), removed: d.removed.slice().sort(this.byId_('recordId')) };
  },
  sameContent(a, b) { return JSON.stringify(this.canon_(a)) === JSON.stringify(this.canon_(b)); },

  // 端末に書く差分（local＝今の端末の内容、merged＝足し合わせた結果）。
  // deleteIds の件数が多いときは、書く前に確認を出す（第11-16節。KE.SYNC_DELETE_GUARD）
  diff(local, merged) {
    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    const lr = new Map(local.records.map(r => [r.recordId, r]));
    const mr = new Set(merged.records.map(r => r.recordId));
    const ls = new Map(local.songs.map(s => [s.songId, s]));
    const lm = new Map(local.removed.map(x => [x.recordId, x.deletedAt]));
    const mm = new Set(merged.removed.map(x => x.recordId));
    return {
      putRecords: merged.records.filter(r => !lr.has(r.recordId) || !same(lr.get(r.recordId), r)),
      deleteIds: local.records.filter(r => !mr.has(r.recordId)).map(r => r.recordId),
      putRemoved: merged.removed.filter(x => lm.get(x.recordId) !== x.deletedAt),
      dropRemovedIds: local.removed.filter(x => !mm.has(x.recordId)).map(x => x.recordId),
      putSongs: merged.songs.filter(s => !ls.has(s.songId) || !same(ls.get(s.songId), s)),
      settings: same(local.settings, merged.settings) ? null : merged.settings,
    };
  },
  // ドライブへ送る形（savedAt はGASが付ける）
  toWire(doc, appVersion) {
    return { app: 'KE30minutos', schema: this.SCHEMA, appVersion: appVersion, settings: doc.settings, songs: doc.songs, records: doc.records, removed: doc.removed };
  },
};
if (typeof module !== 'undefined') module.exports = { SyncCore };

// 同期の進め方（仕様書 第11-18節）。通信は Drive、保存は Store を使う
const Sync = {
  state: 'idle',            // 'idle' / 'running' / 'waitGuard'
  changeSeq: 0,             // 端末の変更を数える（同期の途中で変更があったかを見る）
  pendingGuard: null,       // 削除の確認待ちの内容 { n }
  status: { kind: '', text: '' },   // 設定タブの #syncStatus に出す内容（kind＝'ok' / 'bad' / 'run' / ''）
  timer_: null,
  again_: false,
  guardAllowed_: false,

  markDirty() {
    this.changeSeq++;
    Util.lsSet(KE.LS.SYNC_DIRTY, '1');
  },

  // いつ行うか（reason の表は仕様書 11-18）
  request(reason) {
    if (!Drive.isReady()) {
      if (reason === 'manual') UI.showMessage(TEXT.DRIVE_NEED_SETTINGS, 'warn');
      return;
    }
    if (reason === 'change') {
      if (this.timer_) clearTimeout(this.timer_);
      this.timer_ = setTimeout(() => { this.timer_ = null; this.run_('change', false); }, KE.SYNC_DEBOUNCE_MS);
      return;
    }
    if (reason === 'visible') {
      const last = Util.lsGetNum(KE.LS.LAST_SYNC, 0);
      if (!(Util.lsGet(KE.LS.SYNC_DIRTY) === '1' || Date.now() - last >= KE.SYNC_MIN_INTERVAL_MS)) return;
    }
    this.run_(reason, reason === 'manual');
  },

  isPlaying_() {
    const st = Session.state;
    return st === KE.STATE.LOADING || st === KE.STATE.PLAYING || st === KE.STATE.PAUSED;
  },

  setStatus_(kind, text) {
    this.status = { kind, text };
    UI.renderSyncStatus();
  },

  // 端末の内容を、SyncCore の形で作る
  async buildLocal_() {
    const removed = await Store.getAllRemoved();
    const songs = (await Store.getAllSongs()).filter((s) => s.paramsAt > 0);
    return SyncCore.normalizeDoc({
      app: 'KE30minutos', schema: SyncCore.SCHEMA,
      settings: { targetMin: Util.lsGetNum(KE.LS.TARGET_MIN, KE.TARGET_MIN_DEFAULT), updatedAt: Util.lsGetNum(KE.LS.TARGET_MIN_AT, 0) },
      songs: songs.map((s) => ({ songId: s.songId, name: s.name, size: s.size, durationSec: s.durationSec, pitch: s.pitch, speed: s.speed, paramsAt: s.paramsAt })),
      records: Records.getAll(),
      removed,
    }) || SyncCore.emptyDoc();
  },

  async run_(reason, manual) {
    if (!Drive.isReady()) return;
    if (this.state === 'running') { this.again_ = true; return; }
    if (this.state === 'waitGuard' && !manual) return;      // 確認が出ている間は、自動の同期を始めない
    if (this.isPlaying_()) return;                          // 再生中は行わない（再生が終わるとき session-end で行う）
    const allowed = this.guardAllowed_;
    this.guardAllowed_ = false;
    this.state = 'running';
    UI.hideSyncGuard();
    this.pendingGuard = null;
    this.setStatus_('run', TEXT.SYNC_RUNNING);
    const startSeq = this.changeSeq;
    let outcome;
    try {
      outcome = await this.cycle_(allowed);
    } catch (e) {
      outcome = { fail: Util.fill(TEXT.ERR_DRIVE_OTHER, { code: 'APP' }) };
    }
    if (outcome.guard) {
      this.state = 'waitGuard';
      this.pendingGuard = { n: outcome.guard };
      this.setStatus_('bad', Util.fill(TEXT.WARN_SYNC_GUARD, { n: outcome.guard }));
      UI.showSyncGuard(outcome.guard);
      return;
    }
    this.state = 'idle';
    if (outcome.fail) {
      this.setStatus_('bad', outcome.fail);
      if (manual) UI.showMessage(outcome.fail, 'error');
    } else {
      Util.lsSet(KE.LS.LAST_SYNC, Date.now());
      if (this.changeSeq === startSeq) Util.lsRemove(KE.LS.SYNC_DIRTY); else this.again_ = true;
      const changed = outcome.records > 0 || outcome.songs > 0;
      const text = changed ? Util.fill(TEXT.INFO_SYNC_OK, { r: outcome.records, s: outcome.songs }) : TEXT.INFO_SYNC_SAME;
      this.setStatus_('ok', text);
      if (manual) UI.showMessage(text, 'info');
    }
    UI.renderSyncStatus();
    UI.renderBackupWarn();
    if (this.again_) { this.again_ = false; if (!this.isPlaying_()) this.request('change'); }
  },

  // 1回分の流れ（手順2〜8）。戻り値 { fail } / { guard:件数 } / { records, songs }
  async cycle_(allowed) {
    let local = await this.buildLocal_();
    let got = await Drive.getSync();
    if (!got.ok) return { fail: Drive.errorText(got) };
    let sync = got.sync;
    let recordsApplied = 0;
    let songsApplied = 0;
    for (let tries = 0; ; tries++) {
      let remote;
      let base = 0;
      if (sync === null || sync === undefined) {
        remote = SyncCore.emptyDoc();
      } else {
        remote = SyncCore.normalizeDoc(sync);
        if (!remote) return { fail: TEXT.ERR_SYNC_FORMAT };
        base = Number(sync.savedAt) || 0;
      }
      const hasRemote = !(sync === null || sync === undefined);
      const merged = SyncCore.merge(local, remote, Date.now());
      const df = SyncCore.diff(local, merged);
      if (merged.records.length > KE.RECORDS_MAX) return { fail: Util.fill(TEXT.ERR_SYNC_FULL, { max: KE.RECORDS_MAX }) };
      if (!allowed && df.deleteIds.length >= KE.SYNC_DELETE_GUARD) return { guard: df.deleteIds.length };

      // 端末に書く（1回の書き込み）。SYNC_DIRTY は付けない
      const hasChange = df.putRecords.length || df.deleteIds.length || df.putRemoved.length || df.dropRemovedIds.length || df.putSongs.length || df.settings;
      if (hasChange) {
        try { await Store.applySync(df); } catch (e) { return { fail: TEXT['ERR_' + Store.toKeError(e).code] || TEXT.ERR_DB }; }
        if (df.settings) {
          Util.lsSet(KE.LS.TARGET_MIN, df.settings.targetMin);
          Util.lsSet(KE.LS.TARGET_MIN_AT, df.settings.updatedAt);
        }
        recordsApplied += df.putRecords.length;
        songsApplied += df.putSongs.length;
        await Records.refresh();
        await Library.refresh();
        UI.render();
      }
      local = merged;

      // ドライブに書く
      if (hasRemote && SyncCore.sameContent(merged, remote)) break;
      const put = await Drive.putSync(base, SyncCore.toWire(merged, KE.APP_VERSION));
      if (put.ok) break;
      if (put.code === 'CONFLICT') {
        if (tries + 1 >= KE.SYNC_RETRY_MAX) return { fail: TEXT.ERR_SYNC_CONFLICT };
        sync = put.sync === undefined ? null : put.sync;
        continue;
      }
      return { fail: Drive.errorText(put) };
    }
    return { records: recordsApplied, songs: songsApplied };
  },

  // 削除の確認：「反映する」
  onGuardOk() {
    this.guardAllowed_ = true;
    this.state = 'idle';
    this.run_('manual', true);
  },
  // 削除の確認：「反映しない」
  onGuardNo() {
    this.state = 'idle';
    this.pendingGuard = null;
    this.guardAllowed_ = false;
    UI.hideSyncGuard();
    this.setStatus_('bad', TEXT.INFO_SYNC_GUARD_NO);
    UI.showMessage(TEXT.INFO_SYNC_GUARD_NO, 'info');
  },
};
