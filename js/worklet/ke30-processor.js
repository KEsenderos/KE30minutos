// KE30minutos  ke30-processor.js  版 0.4.1  基づく仕様書：KE30minutos_仕様書_v0.4.1.md
// 役割：曲の音声データを持ち、キー（半音）と速度を別々に変えて、リアルタイムに音を作る。
// 方式：WSOLA（波形の似た位置を探してつなぐ重ね合わせ方式）＋線形補間による読み出し。
// 元：KElástico 仕様書 v0.2.5 第8-2節の StretchCore（変更なし）。Ke30Processor に「次の曲を1つ預かる口」を足した（仕様書 第10-2節）。

class StretchCore {
  constructor(sr) {
    this.sr = sr;
    let n = 1;
    while (n < sr * 0.046) n <<= 1;           // 44.1kHz/48kHz とも 2048
    this.N = n;                               // 1つの断片の長さ
    this.H = n >> 1;                          // 断片を置く間隔（半分ずつ重ねる）
    this.SEEK = Math.round(sr * 0.012);       // 似た位置を探す範囲（前後約12ミリ秒）
    this.ref = new Float32Array(n >> 3);           // 比べる元の波形（findStart_ で使う）
    this.win = new Float32Array(n);
    for (let i = 0; i < n; i++) this.win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
    this.ch = [];
    this.len = 0;
    this.ratio = 1;                           // キーの倍率 2^(半音/12)
    this.speed = 1;
    this.acc = [];
    this.out = [];
    this.reset_(0);
  }

  load(channels) {
    this.ch = channels;
    this.len = channels.length ? channels[0].length : 0;
    this.acc = [new Float32Array(this.N), new Float32Array(this.N)];
    this.out = [new Float32Array(this.H), new Float32Array(this.H)];
    this.reset_(0);
  }

  setParams(semitones, speed) {
    this.ratio = Math.pow(2, semitones / 12);
    this.speed = speed;
  }

  seekTo(sample) {
    this.reset_(Math.max(0, Math.min(this.len, sample)));
  }

  positionSec() {
    return Math.min(this.len, Math.max(0, this.srcPos)) / this.sr;
  }

  reset_(pos) {
    this.srcPos = pos;
    this.prevStart = -1;
    for (const a of this.acc) a.fill(0);
    this.outFill = 0;
    this.outRead = 0;
    this.ended = false;
  }

  read_(c, x) {
    if (x < 0 || x >= this.len - 1) return 0;
    const i = Math.floor(x);
    const f = x - i;
    const d = this.ch[c];
    return d[i] + (d[i + 1] - d[i]) * f;
  }

  findStart_() {
    const nominal = this.srcPos;
    if (this.prevStart < 0) return nominal;
    const p = this.ratio;
    const target = this.prevStart + this.H * p;
    const M = this.H >> 2;
    const ref = this.ref;
    for (let j = 0; j < M; j++) ref[j] = this.read_(0, target + 4 * j * p);
    const d0 = this.ch[0];
    const last = this.len - 1;
    const step = 4 * p;
    // 粗く探してから（8サンプルおき）、見つけた位置の前後を細かく探す（2サンプルおき）
    let best = nominal;
    let bestScore = -Infinity;
    const score = (cand) => {
      let dot = 0;
      let en = 0;
      let x = cand;
      for (let j = 0; j < M; j++, x += step) {
        let b = 0;
        if (x >= 0 && x < last) {
          const i = Math.floor(x);
          const f = x - i;
          b = d0[i] + (d0[i + 1] - d0[i]) * f;
        }
        dot += ref[j] * b;
        en += b * b;
      }
      return dot / Math.sqrt(en + 1e-9);
    };
    const reach = this.SEEK - (this.SEEK % 8);           // 0 を必ず含む（キー±0・速度1.00倍で元の音と一致させるため）
    for (let d = -reach; d <= reach; d += 8) {
      const sc = score(nominal + d);
      if (sc > bestScore) { bestScore = sc; best = nominal + d; }
    }
    const center = best;
    for (let d = -6; d <= 6; d += 2) {
      if (d === 0) continue;
      const sc = score(center + d);
      if (sc > bestScore) { bestScore = sc; best = center + d; }
    }
    return best;
  }

  makeGrain_() {
    const start = this.findStart_();
    const p = this.ratio;
    const nc = this.ch.length;
    for (let c = 0; c < 2; c++) {
      const src = Math.min(c, nc - 1);
      const a = this.acc[c];
      for (let i = 0; i < this.N; i++) a[i] += this.win[i] * this.read_(src, start + i * p);
      this.out[c].set(a.subarray(0, this.H));
      a.copyWithin(0, this.H);
      a.fill(0, this.N - this.H);
    }
    this.prevStart = start;
    this.srcPos += this.speed * this.H;
    if (this.srcPos >= this.len + this.N * p) this.ended = true;
    this.outFill = this.H;
    this.outRead = 0;
  }

  render(outs, frames) {
    for (let f = 0; f < frames; f++) {
      if (this.outRead >= this.outFill) {
        if (this.ended) return;
        this.makeGrain_();
      }
      for (let c = 0; c < outs.length; c++) outs[c][f] = this.out[Math.min(c, 1)][this.outRead];
      this.outRead++;
    }
  }
}

if (typeof registerProcessor === 'function') {
  class Ke30Processor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.core = new StretchCore(sampleRate);
      this.playing = false;
      this.tick = 0;
      this.next = null;                                      // 預かっている次の曲
      this.port.onmessage = (e) => this.onMessage_(e.data);
    }
    onMessage_(m) {
      if (m.type === 'load') { this.core.load(m.channels); this.playing = false; this.next = null; }
      else if (m.type === 'queue') this.next = { channels: m.channels, pitch: m.pitch, speed: m.speed };
      else if (m.type === 'switchNext') { if (this.next) this.advance_(); }
      else if (m.type === 'dropNext') this.next = null;
      else if (m.type === 'params') this.core.setParams(m.pitch, m.speed);
      else if (m.type === 'seek') this.core.seekTo(Math.round(m.sec * sampleRate));
      else if (m.type === 'play') this.playing = true;
      else if (m.type === 'pause') this.playing = false;
      else if (m.type === 'unload') { this.core.load([]); this.playing = false; this.next = null; }
    }
    advance_() {                                             // 預かっていた次の曲に切り替える（鳴らし続ける）
      const n = this.next; this.next = null;
      this.core.load(n.channels);
      this.core.setParams(n.pitch, n.speed);
      this.port.postMessage({ type: 'advanced' });
    }
    process(inputs, outputs) {
      if (!this.playing || !this.core.len) return true;
      const out = outputs[0];
      this.core.render(out, out[0].length);
      if (++this.tick % 8 === 0) this.port.postMessage({ type: 'pos', sec: this.core.positionSec() });
      if (this.core.ended) {
        if (this.next) this.advance_();                      // 預かっていれば、そのまま次の曲へ
        else { this.playing = false; this.port.postMessage({ type: 'ended' }); }
      }
      return true;
    }
  }
  registerProcessor('ke30-processor', Ke30Processor);
}

if (typeof module !== 'undefined') module.exports = { StretchCore };
