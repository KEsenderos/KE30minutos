// KE30minutos  player.js  版 0.4.1  基づく仕様書：KE30minutos_仕様書_v0.4.1.md
// 役割：今の曲の状態と操作（読み込み、再生・一時停止、キー・速度、先読みと切り替え）。仕様書 第11-3・11-7・11-10節
const Player = {
  songId: null,
  song: null,                 // 今の曲の記録（名前など）
  pitch: 0,
  speed: 1.0,
  position: 0,                // 曲の時間（秒）
  duration: 0,
  loadToken: 0,
  queued: null,               // 先読みして預けた次の曲 { songId, durationSec, pitch, speed }
  preloadState: 'none',       // 'none' / 'loading' / 'queued' / 'skipped'
  saveTimer_: null,
  saveDirty_: false,
  replanTimer_: null,
  raf_: 0,

  init() {
    this.clearSong();
  },
  clearSong() {
    this.songId = null; this.song = null; this.pitch = 0; this.speed = 1.0;
    this.position = 0; this.duration = 0; this.queued = null; this.preloadState = 'none';
  },

  // ── 曲を読み込んで再生する（11-3）──
  async selectSong(songId) {
    const token = ++this.loadToken;
    if (Session.state === KE.STATE.PLAYING) Engine.pause();
    Session.state = KE.STATE.LOADING;
    this.flushSave();
    this.songId = songId;
    this.song = Library.find(songId);
    this.queued = null; this.preloadState = 'none';
    this.position = 0; this.duration = 0;
    Util.lsSet(KE.LS.LOADING, songId);
    UI.render();
    let r;
    try {
      await Engine.ensureContext_();
      const blob = await Store.getFileBlob(songId);
      if (!blob) throw new KeError('DB');
      r = await Engine.loadSong(blob);
    } catch (e) {
      if (token !== this.loadToken) return;              // 後から来た読み込みが勝つ
      Util.lsRemove(KE.LS.LOADING);
      const err = e instanceof KeError ? e : new KeError('DECODE');
      UI.showError(err, this.song ? this.song.name : songId);
      Session.onLoadFailed_(songId, 'current');
      return;
    }
    if (token !== this.loadToken) return;
    Util.lsRemove(KE.LS.LOADING);
    // 保存されているキー・速度、記録の更新
    let rec = null;
    try { rec = await Store.getSong(songId); } catch (e) { rec = this.song; }
    if (token !== this.loadToken) return;
    rec = rec || this.song;
    this.song = rec || this.song;
    this.pitch = rec ? rec.pitch : 0;
    this.speed = rec ? rec.speed : 1.0;
    this.duration = r.durationSec;
    this.position = 0;
    Engine.setParams(this.pitch, this.speed);
    const entry = Session.currentEntry();
    const oldDur = rec ? rec.durationSec : 0;
    Store.updateSongMeta(songId, { durationSec: r.durationSec, durationSrc: 'decoded', lastPlayedAt: Date.now() }).then(() => {
      const c = Library.find(songId);
      if (c) { c.durationSec = r.durationSec; c.durationSrc = 'decoded'; }
    }).catch(() => {});
    if (entry && entry.id === songId && Math.abs(r.durationSec - oldDur) >= 2) {
      entry.effSec = Math.round(r.durationSec / this.speed) + KE.GAP_SEC;
    }
    Session.onSongStarted_();
    Session.lastPos_ = 0;
    MediaCtl.setMetadata(this.song, this.pitch, this.speed);
    await this.play();
    if (entry && entry.id === songId && Math.abs(r.durationSec - oldDur) >= 2) Session.maybeReplan('duration');
  },

  // ── 再生・一時停止 ──
  async play() {
    Engine.unlock();
    try { await Engine.ensureRunning_(); } catch (e) { UI.showError(e instanceof KeError ? e : new KeError('AUDIO')); Session.state = KE.STATE.PAUSED; UI.render(); return; }
    MediaCtl.startSilence();
    Session.lastPos_ = this.position;           // 一時停止から戻ったときは、前回の位置を今の位置にそろえる
    Engine.play();
    Session.state = KE.STATE.PLAYING;
    MediaCtl.setPlaybackState(Session.state);
    UI.render();
  },
  pause() {
    if (Session.state !== KE.STATE.PLAYING) return;
    Engine.pause();
    Session.state = KE.STATE.PAUSED;
    MediaCtl.setPlaybackState(Session.state);
    Session.saveProgress_();
    UI.render();
  },
  // 再生ボタン（タップの中で呼ばれる。AudioContext の準備はここで同期的に行う）
  togglePlay() {
    Engine.unlock();
    MediaCtl.startSilence();
    const st = Session.state;
    if (st === KE.STATE.PLAYING) this.pause();
    else if (st === KE.STATE.PAUSED) this.play();
    else if (st === KE.STATE.IDLE || st === KE.STATE.FINISHED) Session.start();
    // LOADING は押せない
  },

  // ── 位置を受け取る ──
  onPosition_(sec) {
    this.position = sec;
    Session.onPosition(sec);
    if (this.preloadState === 'none' && Session.state === KE.STATE.PLAYING && !Session.isOnLast_()) {
      const remain = (this.duration - sec) / (this.speed || 1);
      if (this.duration > 0 && remain <= KE.PRELOAD_LEAD_SEC) this.maybePreload_();
    }
    if (!this.raf_) {
      this.raf_ = requestAnimationFrame(() => { this.raf_ = 0; UI.renderPosition(); });
    }
  },

  // ── 先読み（11-10）──
  async maybePreload_() {
    this.preloadState = 'loading';
    const token = this.loadToken;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (token !== this.loadToken) { this.preloadState = 'none'; return; }
      const next = Session.peekNext_();
      if (!next) { this.preloadState = 'skipped'; return; }
      const ns = Library.find(next.id);
      const rate = (Engine.ctx && Engine.ctx.sampleRate) || 48000;
      const bytes = ((this.duration || 0) + (ns ? ns.durationSec : 0)) * rate * 2 * 4;
      if (bytes > KE.PRELOAD_MAX_BYTES) { this.preloadState = 'skipped'; return; }
      try {
        const blob = await Store.getFileBlob(next.id);
        if (!blob) throw new KeError('DB');
        const rec = await Store.getSong(next.id);
        const pitch = rec ? rec.pitch : 0;
        const speed = rec ? rec.speed : 1.0;
        const r = await Engine.preloadNext(blob, pitch, speed, () => token === this.loadToken && (Session.state === KE.STATE.PLAYING || Session.state === KE.STATE.PAUSED));
        if (!r.posted) { this.preloadState = 'none'; return; }
        this.queued = { songId: next.id, durationSec: r.durationSec, pitch, speed };
        this.preloadState = 'queued';
        Session.lockNext_();
        return;
      } catch (e) {
        if (token !== this.loadToken) { this.preloadState = 'none'; return; }
        const err = e instanceof KeError ? e : new KeError('DECODE');
        const nm = ns ? ns.name : next.id;
        UI.showError(err, nm);
        Session.onLoadFailed_(next.id, 'next');
      }
    }
    this.preloadState = 'skipped';
  },
  // 処理側が次の曲へ切り替えた（'advanced'）
  onAdvanced_() {
    const q = this.queued;
    if (!q) return;
    Session.onAdvanced_();
    this.songId = q.songId;
    this.song = Library.find(q.songId) || this.song;
    this.pitch = q.pitch;
    this.speed = q.speed;
    this.duration = q.durationSec;
    this.position = 0;
    this.queued = null;
    this.preloadState = 'none';
    Store.updateSongMeta(q.songId, { durationSec: q.durationSec, durationSrc: 'decoded', lastPlayedAt: Date.now() }).catch(() => {});
    const entry = Session.currentEntry();
    if (entry && entry.id === q.songId) entry.effSec = Math.round(q.durationSec / q.speed) + KE.GAP_SEC;
    MediaCtl.setMetadata(this.song, this.pitch, this.speed);
    UI.render();
  },

  // ── キーと速度（11-7）──
  canChange_() { return Session.state === KE.STATE.PLAYING || Session.state === KE.STATE.PAUSED; },
  changePitch(delta) { this.setPitchValue_(this.pitch + delta); },
  changeSpeed(delta) { this.setSpeedValue_(this.speed + delta); },
  setPitch(level) { this.setPitchValue_(level); },                          // 段階の番号＝半音
  setSpeed(level) { this.setSpeedValue_(Util.speedFromLevel(level)); },
  setPitchValue_(v) {
    if (!this.canChange_()) return;
    this.pitch = Util.clamp(Math.round(v), KE.PITCH_MIN, KE.PITCH_MAX);
    this.applyParams_(false);
  },
  setSpeedValue_(v) {
    if (!this.canChange_()) return;
    this.speed = Util.clamp(Util.roundStep(v, KE.SPEED_STEP), KE.SPEED_MIN, KE.SPEED_MAX);
    this.applyParams_(true);
  },
  resetParams() {
    if (!this.canChange_()) return;
    this.pitch = 0; this.speed = 1.0;
    this.applyParams_(true);
  },
  applyParams_(speedChanged) {
    Engine.setParams(this.pitch, this.speed);
    MediaCtl.setMetadata(this.song, this.pitch, this.speed);
    UI.renderParams();
    UI.renderNow();
    UI.renderPosition();
    this.saveSettings_();
    if (speedChanged) {
      if (this.replanTimer_) clearTimeout(this.replanTimer_);
      this.replanTimer_ = setTimeout(() => { this.replanTimer_ = null; Session.maybeReplan('speed'); }, KE.REPLAN_DEBOUNCE_MS);
    }
  },
  saveSettings_() {
    this.saveDirty_ = true;
    if (this.saveTimer_) clearTimeout(this.saveTimer_);
    this.saveTimer_ = setTimeout(() => { this.saveTimer_ = null; this.doSave_(); }, KE.SAVE_DEBOUNCE_MS);
  },
  // 待っている設定の保存を、すぐ行う（裏に回るとき、曲を切り替えるとき）
  flushSave() {
    if (this.saveTimer_) { clearTimeout(this.saveTimer_); this.saveTimer_ = null; }
    if (this.saveDirty_) this.doSave_();
  },
  doSave_() {
    this.saveDirty_ = false;
    const id = this.songId;
    if (!id) return;
    const pitch = this.pitch, speed = this.speed;
    Store.updateSongSettings(id, pitch, speed).then((changed) => {
      const c = Library.find(id);
      if (c) { c.pitch = pitch; c.speed = speed; if (changed) c.paramsAt = Date.now(); }
      if (changed) { Sync.markDirty(); Sync.request('change'); }
      UI.renderSongs();
    }).catch(() => {});
  },
};
