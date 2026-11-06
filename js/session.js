// KE30minutos  session.js  版 0.5  基づく仕様書：KE30minutos_仕様書_v0.5.md
// 役割：1回の再生（曲順を決める → 順に鳴らす → 終わる）の流れ、時間の数え方、曲順の組み直し、記録の保存（仕様書 第11-2・11-4〜11-6・11-11節）
const Session = {
  state: KE.STATE.IDLE,
  plan: [],               // [{ id, effSec, isLast }]
  index: 0,
  targetSec: 0,
  elapsedSec: 0,          // 実際に聞いた時間
  startedAt: 0,
  songCount: 0,           // 聞き始めた曲の数
  recorded: false,
  summaryText: '',
  lastPos_: null,         // 時間を数えるときの、前回の位置
  nextLocked_: false,     // 次の曲を先読みして預けた（以降の組み直しで動かさない）
  failedIds_: new Set(),
  lastProgressAt_: 0,
  replanTimer_: null,

  init() {
    Engine.onPosition((sec) => Player.onPosition_(sec));
    Engine.onEnded(() => this.onEnded());
    Engine.onAdvanced(() => Player.onAdvanced_());
  },

  // ── 曲の時間 ──
  effSecOf_(song) { return Math.round(song.durationSec / (song.speed || 1)) + KE.GAP_SEC; },
  buildPools_() {
    const f = (list) => list.filter((s) => !this.failedIds_.has(s.songId) && s.durationSec > 0).map((s) => ({ id: s.songId, effSec: this.effSecOf_(s) }));
    return { mainPool: f(Library.getMain()), lastPool: f(Library.getLast()) };
  },
  windowLow_() { return this.targetSec + KE.MARGIN_LOW_SEC; },
  windowTol_() { return KE.TOLERANCE_SEC - KE.MARGIN_LOW_SEC - KE.MARGIN_HIGH_SEC; },
  currentEntry() { return this.plan[this.index] || null; },
  isOnLast_() { const e = this.currentEntry(); return !!(e && e.isLast); },

  // ── 再生の開始（11-2）──
  start() {
    if (DriveImport.isBusy()) { UI.showMessage(TEXT.HINT_IMPORTING, 'warn'); return; }
    if (this.state === KE.STATE.LOADING || this.state === KE.STATE.PLAYING || this.state === KE.STATE.PAUSED) return;
    if (Library.getMain().length === 0) { UI.showMessage(TEXT.HINT_NEED_MAIN, 'warn'); return; }
    this.targetSec = Util.lsGetNum(KE.LS.TARGET_MIN, KE.TARGET_MIN_DEFAULT) * 60;
    this.failedIds_ = new Set();
    const { mainPool, lastPool } = this.buildPools_();
    const res = Planner.plan({
      mainPool, lastPool, targetSec: this.windowLow_(), toleranceSec: this.windowTol_(), fixedSec: 0, maxTries: KE.PLAN_MAX_TRIES,
    });
    if (!res.ids.length) { UI.showMessage(TEXT.HINT_NEED_MAIN, 'warn'); return; }
    const eff = new Map(mainPool.concat(lastPool).map((p) => [p.id, p.effSec]));
    this.plan = res.ids.map((id, i) => ({ id, effSec: eff.get(id) || 0, isLast: res.lastId !== null && i === res.ids.length - 1 }));
    const lines = [];
    let kind = 'info';
    if (!res.inRange) { lines.push(Util.fill(TEXT.WARN_OUT_OF_RANGE, { min: this.targetSec / 60, max: this.targetSec / 60 + KE.TOLERANCE_SEC / 60, total: Util.formatTime(res.totalSec) })); kind = 'warn'; }
    if (res.repeated) lines.push(TEXT.INFO_REPEATED);
    if (lastPool.length === 0) lines.push(TEXT.INFO_NO_LAST);
    if (lines.length) UI.showMessage(lines.join('\n'), kind); else UI.hideMessage();
    this.index = 0;
    this.elapsedSec = 0;
    this.startedAt = Date.now();
    this.songCount = 0;
    this.recorded = false;
    this.summaryText = '';
    this.lastPos_ = null;
    this.nextLocked_ = false;
    this.lastProgressAt_ = Date.now();
    this.state = KE.STATE.LOADING;
    UI.render();
    Player.selectSong(this.plan[0].id);
  },

  // 曲を聞き始めたとき（Player から）
  onSongStarted_() { this.songCount++; },

  // ── 次の曲・曲の終わり・停止（11-5）──
  next() {
    if (this.state !== KE.STATE.PLAYING && this.state !== KE.STATE.PAUSED) return;
    if (this.isOnLast_() || !this.plan[this.index + 1]) { this.finish_(); return; }
    if (Player.queued) {
      Engine.switchNext();                       // すぐ切り替わる。'advanced' が来たら Player.onAdvanced_ が続きを行う
      if (this.state === KE.STATE.PAUSED) Player.play();
      return;
    }
    this.advance_();
    const e = this.currentEntry();
    if (e) Player.selectSong(e.id); else this.finish_();
  },
  onEnded() {
    if (this.state !== KE.STATE.PLAYING) return;
    if (this.isOnLast_() || !this.plan[this.index + 1]) { this.finish_(); return; }
    this.advance_();
    const e = this.currentEntry();
    if (e) Player.selectSong(e.id); else this.finish_();
  },
  // 次の曲へ進む前に、見込みが窓の外なら組み直し（11-4）、index を進める
  advance_() {
    const i = this.index;
    const future = this.plan.slice(i + 1).reduce((a, e) => a + e.effSec, 0);
    const lo = this.windowLow_();
    const projected = this.elapsedSec + future;
    if (projected < lo || projected > lo + this.windowTol_()) {
      this.notifyReplan_(this.replace_(i + 1, this.elapsedSec, 'advance', false));
    }
    this.index = i + 1;
    this.lastPos_ = null;
    this.nextLocked_ = false;
    UI.renderPlan();
  },
  // 'advanced' を受けたとき（Player から）。elapsedSec はそのまま続ける
  onAdvanced_() {
    this.index += 1;
    this.lastPos_ = 0;
    this.nextLocked_ = false;
    this.songCount++;
  },
  peekNext_() {
    if (this.isOnLast_()) return null;
    // まず見込みの合計を調べ、窓の外なら組み直す
    this.maybeReplan('preload');
    return this.plan[this.index + 1] || null;
  },
  lockNext_() { this.nextLocked_ = true; },

  async finish_() {
    if (this.state === KE.STATE.FINISHED || this.state === KE.STATE.IDLE) return;
    Engine.pause();
    Engine.unload();
    Player.loadToken++;
    Player.queued = null; Player.preloadState = 'none';
    Util.lsRemove(KE.LS.LOADING);
    this.state = KE.STATE.FINISHED;
    this.summaryText = Util.fill(TEXT.INFO_FINISHED, { total: Util.formatTime(this.elapsedSec), n: this.songCount });
    MediaCtl.setPlaybackState(this.state);
    this.plan.forEach((e, i) => { e.done = i <= this.index; });
    UI.render();
    await this.saveRecord_();
    Sync.request('session-end');
  },
  async stop() {
    if (this.state === KE.STATE.IDLE || this.state === KE.STATE.FINISHED) return;
    Engine.pause();
    Engine.unload();
    Player.loadToken++;
    Player.queued = null; Player.preloadState = 'none';
    Util.lsRemove(KE.LS.LOADING);
    if (this.replanTimer_) { clearTimeout(this.replanTimer_); this.replanTimer_ = null; }
    Player.flushSave();
    this.state = KE.STATE.IDLE;
    MediaCtl.setPlaybackState(this.state);
    await this.saveRecord_();
    this.plan = [];
    this.index = 0;
    this.nextLocked_ = false;
    Player.clearSong();
    UI.render();
    Sync.request('session-end');
  },

  // ── 時間の数え方（11-6）──
  onPosition(sec) {
    if (this.lastPos_ === null) { this.lastPos_ = sec; return; }
    const d = sec - this.lastPos_;
    if (d > 0 && d < 1) this.elapsedSec += d / (Player.speed || 1);
    this.lastPos_ = sec;
    if (Date.now() - this.lastProgressAt_ >= KE.PROGRESS_SAVE_MS) this.saveProgress_();
  },
  currentRemaining_() {
    const e = this.currentEntry();
    if (!e) return 0;
    if (this.state === KE.STATE.LOADING || !(Player.duration > 0)) return Math.max(0, e.effSec - KE.GAP_SEC);
    return Math.max(0, (Player.duration - Player.position) / (Player.speed || 1));
  },
  futureSec_() { return this.plan.slice(this.index + 1).reduce((a, e) => a + e.effSec, 0); },
  remainingSec() { return this.currentRemaining_() + this.futureSec_(); },
  projectedTotalSec() { return this.elapsedSec + this.remainingSec(); },

  // ── 曲順の組み直し（11-4）──
  // 速度を変えた・長さが違った・先読みの前、に呼ぶ。見込みが窓の外に出たときだけ
  maybeReplan(reason) {
    if (this.state !== KE.STATE.PLAYING && this.state !== KE.STATE.PAUSED && this.state !== KE.STATE.LOADING) return;
    if (this.isOnLast_()) return;
    const lo = this.windowLow_();
    const projected = this.projectedTotalSec();
    if (projected >= lo && projected <= lo + this.windowTol_()) return;
    const locked = this.nextLocked_ && this.plan[this.index + 1];
    const keepN = this.index + 1 + (locked ? 1 : 0);
    const fixed = this.elapsedSec + this.currentRemaining_() + (locked ? this.plan[this.index + 1].effSec : 0);
    this.notifyReplan_(this.replace_(keepN, fixed, reason, false));
    UI.renderPlan();
  },
  // plan の keepN 番目以降を、組み直した曲順に置き換える。置き換えたら Planner の結果、しなければ null
  // force：置き換えたほうが近くなくても置き換える（ラストの曲が消えたときなど）
  replace_(keepN, fixedSec, reason, force) {
    const kept = this.plan.slice(0, keepN);
    const { mainPool, lastPool } = this.buildPools_();
    const exclude = kept.map((e) => e.id);
    const res = Planner.plan({
      mainPool, lastPool, targetSec: this.windowLow_(), toleranceSec: this.windowTol_(),
      fixedSec, excludeIds: exclude, maxTries: KE.PLAN_MAX_TRIES,
    });
    const oldFuture = this.plan.slice(keepN);
    const oldTotal = fixedSec + oldFuture.reduce((a, e) => a + e.effSec, 0);
    const lo = this.windowLow_();
    const tol = this.windowTol_();
    const newDist = Planner.distance_(res.totalSec, lo, tol);
    const oldDist = Planner.distance_(oldTotal, lo, tol);
    const oldHasLast = oldFuture.length > 0 && oldFuture[oldFuture.length - 1].isLast;
    if (!res.ids.length) return null;
    if (!force && oldHasLast && newDist >= oldDist) return null;
    const eff = new Map(mainPool.concat(lastPool).map((p) => [p.id, p.effSec]));
    const fresh = res.ids.map((id, i) => ({ id, effSec: eff.get(id) || 0, isLast: res.lastId !== null && i === res.ids.length - 1 }));
    this.plan = kept.concat(fresh);
    return res;
  },
  // 組み直した結果の知らせ（範囲内なら INFO_REPLANNED、範囲外なら WARN_OUT_OF_RANGE）
  notifyReplan_(res) {
    if (!res) return;
    if (res.inRange) UI.showMessage(TEXT.INFO_REPLANNED, 'info');
    else UI.showMessage(Util.fill(TEXT.WARN_OUT_OF_RANGE, { min: this.targetSec / 60, max: this.targetSec / 60 + KE.TOLERANCE_SEC / 60, total: Util.formatTime(res.totalSec) }), 'warn');
  },

  // ── 曲が読み込めなかったとき（11-3 手順4、11-10 手順4）──
  // where：'current'＝今読み込もうとした曲／'next'＝先読みしようとした曲
  onLoadFailed_(songId, where) {
    if (this.state === KE.STATE.IDLE || this.state === KE.STATE.FINISHED) return;
    const removeIdx = where === 'next' ? this.index + 1 : this.index;
    const entry = this.plan[removeIdx];
    if (!entry || entry.id !== songId) return;
    this.plan.splice(removeIdx, 1);
    this.failedIds_.add(songId);
    const fixed = this.elapsedSec + (where === 'next' ? this.currentRemaining_() : 0);
    const future = this.plan.slice(removeIdx).reduce((a, e) => a + e.effSec, 0);
    const projected = fixed + future;
    const lo = this.windowLow_();
    const out = projected < lo || projected > lo + this.windowTol_() || entry.isLast || this.plan.length <= removeIdx;
    if (out) this.notifyReplan_(this.replace_(removeIdx, fixed, 'loadfail', entry.isLast));
    UI.renderPlan();
    if (where === 'current') {
      const e = this.currentEntry();
      if (e) Player.selectSong(e.id); else this.finish_();
    }
  },

  // ── 記録の保存（11-11）──
  async saveRecord_() {
    if (this.recorded) return;
    if (this.elapsedSec < KE.RECORD_MIN_SEC) { Util.lsRemove(KE.LS.PROGRESS); return; }
    const playSec = Math.round(this.elapsedSec);
    try {
      const rec = await Records.add({
        date: RecordsCore.dayStr(this.startedAt, KE.DAY_START_HOUR), startedAt: this.startedAt, playSec,
        targetSec: this.targetSec, songCount: this.songCount,
        completed: RecordsCore.isCompleted(playSec, this.targetSec), source: 'auto',
      });
      this.recorded = true;
      Util.lsRemove(KE.LS.PROGRESS);
      UI.showMessage(Util.fill(rec.completed ? TEXT.INFO_REC_SAVED_DONE : TEXT.INFO_REC_SAVED, { play: RecordsCore.formatDuration(playSec) }), 'info');
      UI.renderRecords();
      UI.renderBackupWarn();
    } catch (e) {
      UI.showError(e instanceof KeError ? e : Store.toKeError(e));    // REC_FULL など。PROGRESS は消さない
    }
  },
  saveProgress_() {
    this.lastProgressAt_ = Date.now();
    if (this.state === KE.STATE.IDLE || this.state === KE.STATE.FINISHED) return;
    Util.lsSet(KE.LS.PROGRESS, JSON.stringify({ startedAt: this.startedAt, targetSec: this.targetSec, elapsedSec: Math.round(this.elapsedSec), songCount: this.songCount }));
  },
};
