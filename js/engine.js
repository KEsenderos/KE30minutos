// KE30minutos  engine.js  版 0.5  基づく仕様書：KE30minutos_仕様書_v0.5.md
// 役割：音の再生の土台（AudioContext と AudioWorklet の管理）、曲の長さの調べ方、次の曲の先読み（仕様書 第10章）
const Engine = {
  ctx: null,
  node: null,
  durationSec: 0,
  ready_: null,                 // ensureContext_ の途中経過（二重に作らないため）
  posCb_: null,
  endedCb_: null,
  advancedCb_: null,

  // ── 曲の長さの調べ方（第10-1節）──
  probeDuration(blob) {
    return new Promise((resolve) => {
      let url = null;
      let a = null;
      let finished = false;
      const done = (v) => {
        if (finished) return;
        finished = true;
        try { if (url) URL.revokeObjectURL(url); } catch (e) { /* 無視 */ }
        try { if (a) a.removeAttribute('src'); } catch (e) { /* 無視 */ }
        resolve(v);
      };
      try {
        url = URL.createObjectURL(blob);
        a = new Audio();
        const timer = setTimeout(() => done(null), 8000);
        a.preload = 'metadata';
        a.onloadedmetadata = () => { clearTimeout(timer); done(isFinite(a.duration) && a.duration > 0 ? a.duration : null); };
        a.onerror = () => { clearTimeout(timer); done(null); };
        a.src = url;
      } catch (e) {
        done(null);
      }
    });
  },
  async decodeDuration(blob) {
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ab = await new Ctx(1, 1, 44100).decodeAudioData(await blob.arrayBuffer());
    return ab.duration;
  },

  // ── 土台の準備 ──
  // タップの中で呼ぶ：AudioContext をその場で作り、resume を始める（iPhoneは、タップの中で行わないと音が出ない）。待たない。
  unlock() {
    try {
      if (!this.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        this.ctx = new Ctx({ latencyHint: 'playback' });
      }
      if (this.ctx.state !== 'running') {
        const p = this.ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
    } catch (e) { /* ensureContext_ で改めて失敗を扱う */ }
  },
  async ensureContext_() {
    if (this.node) return;
    if (this.ready_) { await this.ready_; return; }
    this.ready_ = (async () => {
      try {
        if (!this.ctx) {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          this.ctx = new Ctx({ latencyHint: 'playback' });
        }
        await this.ctx.audioWorklet.addModule('js/worklet/ke30-processor.js');
        const node = new AudioWorkletNode(this.ctx, 'ke30-processor', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
        node.port.onmessage = (e) => this.onMessage_(e.data);
        node.connect(this.ctx.destination);
        this.node = node;
      } catch (e) {
        this.ready_ = null;
        throw new KeError('AUDIO', e && e.message);
      }
    })();
    await this.ready_;
  },
  async ensureRunning_() {
    await this.ensureContext_();
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch (e) { throw new KeError('AUDIO', e && e.message); }
    }
  },
  onMessage_(m) {
    if (!m) return;
    if (m.type === 'pos') { if (this.posCb_) this.posCb_(m.sec); }
    else if (m.type === 'ended') { if (this.endedCb_) this.endedCb_(); }
    else if (m.type === 'advanced') { if (this.advancedCb_) this.advancedCb_(); }
  },
  onPosition(cb) { this.posCb_ = cb; },
  onEnded(cb) { this.endedCb_ = cb; },
  onAdvanced(cb) { this.advancedCb_ = cb; },

  // ── 曲の読み込み ──
  // blob をデコードして左右の音声データにする（長さの上限を超えたら TOO_LONG）
  async decode_(blob) {
    const bytes = await blob.arrayBuffer();
    let ab;
    try {
      ab = await this.ctx.decodeAudioData(bytes);            // 端末のサンプルレートに変換される
    } catch (e) {
      throw new KeError('DECODE', e && e.message);
    }
    const durationSec = ab.duration;
    if (durationSec > KE.MAX_DURATION_SEC) { ab = null; throw new KeError('TOO_LONG', durationSec); }
    const channels = [];
    for (let c = 0; c < Math.min(2, ab.numberOfChannels); c++) {
      const arr = new Float32Array(ab.length);
      ab.copyFromChannel(arr, c);
      channels.push(arr);
    }
    ab = null;                                              // 元のデータへの参照を消す
    return { channels, durationSec };
  },
  async loadSong(blob) {
    await this.ensureContext_();
    this.node.port.postMessage({ type: 'unload' });         // 先に前の曲（と預かっている次の曲）を捨てる（メモリ節約）
    const r = await this.decode_(blob);
    this.node.port.postMessage({ type: 'load', channels: r.channels }, r.channels.map((a) => a.buffer));
    this.durationSec = r.durationSec;
    return { durationSec: r.durationSec };
  },
  // 次の曲を読み込んで預ける（今の曲は捨てない。第10-2節）
  // shouldPost：読み込みが終わった時点で、まだ預けてよいかを答える関数（曲が切り替わっていたら偽 → 預けずに捨てる）
  async preloadNext(blob, pitch, speed, shouldPost) {
    await this.ensureContext_();
    const r = await this.decode_(blob);
    if (shouldPost && !shouldPost()) return { durationSec: r.durationSec, posted: false };
    this.node.port.postMessage({ type: 'queue', channels: r.channels, pitch, speed }, r.channels.map((a) => a.buffer));
    return { durationSec: r.durationSec, posted: true };
  },
  switchNext() { if (this.node) this.node.port.postMessage({ type: 'switchNext' }); },
  dropNext() { if (this.node) this.node.port.postMessage({ type: 'dropNext' }); },

  // ── 操作 ──
  play() { if (this.node) this.node.port.postMessage({ type: 'play' }); },
  pause() { if (this.node) this.node.port.postMessage({ type: 'pause' }); },
  seek(sec) { if (this.node) this.node.port.postMessage({ type: 'seek', sec }); },
  setParams(pitch, speed) { if (this.node) this.node.port.postMessage({ type: 'params', pitch, speed }); },
  unload() { if (this.node) this.node.port.postMessage({ type: 'unload' }); this.durationSec = 0; },
};
