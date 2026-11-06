// KE30minutos  media.js  版 0.5  基づく仕様書：KE30minutos_仕様書_v0.5.md
// 役割：無音のaudio要素（iPhoneに「再生中のアプリ」と認めさせ続ける）、ロック画面・イヤホンのボタン（仕様書 第12-1・12-2節）
const MediaCtl = {
  silenceEl_: null,
  lastToggleAt_: 0,
  started_: false,
  posTimer_: null,

  init() {
    const el = document.getElementById('ke30Silence');
    this.silenceEl_ = el;
    if (el) {
      try { el.src = Util.makeSilentWavUrl(); el.loop = true; } catch (e) { /* 続行 */ }
    }
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* 未対応なら何もしない */ }
    const ms = navigator.mediaSession;
    if (ms && ms.setActionHandler) {
      const set = (name, fn) => { try { ms.setActionHandler(name, fn); } catch (e) { /* 未対応の命令は無視 */ } };
      // 命令名に関係なく、アプリの状態で切り替える（ルールブック6-6）
      set('play', () => this.handleToggle_());
      set('pause', () => this.handleToggle_());
      set('stop', () => this.handleToggle_());
      set('nexttrack', () => Session.next());
      ['previoustrack', 'seekbackward', 'seekforward', 'seekto'].forEach((n) => set(n, null));
    }
    if (!this.posTimer_) {
      this.posTimer_ = setInterval(() => {
        if (Session.state === KE.STATE.PLAYING || Session.state === KE.STATE.PAUSED) this.updatePosition(Player.position, Player.duration, Player.speed);
      }, KE.POSITION_STATE_MS);
    }
  },

  // 最初の「再生」操作の中で鳴らし始め、以後止めない
  startSilence() {
    if (this.started_ || !this.silenceEl_) return;
    try {
      const p = this.silenceEl_.play();
      if (p && p.then) p.then(() => { this.started_ = true; }).catch(() => { /* 失敗しても続行 */ });
      else this.started_ = true;
    } catch (e) { /* 続行 */ }
  },

  setMetadata(song, pitch, speed) {
    const ms = navigator.mediaSession;
    if (!ms || typeof MediaMetadata === 'undefined') return;
    try {
      ms.metadata = new MediaMetadata({
        title: song ? Util.stripExt(song.name) : '',
        artist: Util.fill(TEXT.SETTING_BADGE, { p: Util.formatPitch(pitch), s: Number(speed).toFixed(2) }),
        album: 'KE30minutos',
        artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
      });
    } catch (e) { /* 何もしない */ }
  },

  setPlaybackState(state) {
    const ms = navigator.mediaSession;
    if (!ms) return;
    try { ms.playbackState = state === KE.STATE.PLAYING ? 'playing' : 'paused'; } catch (e) { /* 何もしない */ }
  },

  updatePosition(pos, duration, speed) {
    const ms = navigator.mediaSession;
    if (!ms || !ms.setPositionState || !(duration > 0)) return;
    try {
      ms.setPositionState({ duration, position: Util.clamp(pos || 0, 0, duration), playbackRate: speed || 1 });
    } catch (e) { /* 未対応なら何もしない */ }
  },

  // イヤホンの再生／一時停止：前回から HEADSET_DEBOUNCE_MS 以内の連続は無視
  handleToggle_() {
    const now = Date.now();
    if (now - this.lastToggleAt_ < KE.HEADSET_DEBOUNCE_MS) return;
    this.lastToggleAt_ = now;
    const st = Session.state;
    if (st === KE.STATE.PLAYING) Player.pause();
    else if (st === KE.STATE.PAUSED) Player.play();
    else if (st === KE.STATE.IDLE || st === KE.STATE.FINISHED) Session.start();
    // LOADING は何もしない
  },
};
