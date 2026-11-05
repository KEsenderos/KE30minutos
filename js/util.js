// KE30minutos  util.js  版 0.4.1  基づく仕様書：KE30minutos_仕様書_v0.4.1.md
// 役割：小さな共通処理（文字の差し込み、時間・キー・速度の表示、localStorage、曲のID、無音のWAV）。

const Util = {
  seq_: 0,

  fill(text, obj) {
    return String(text).replace(/\{(\w+)\}/g, (m, k) => (obj && obj[k] != null ? obj[k] : m));
  },

  // 3:07 ／ 1:02:03 ／ 不明なら --:--
  formatTime(sec) {
    if (typeof sec !== 'number' || !isFinite(sec) || sec < 0) return '--:--';
    const s = Math.floor(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return h > 0 ? h + ':' + p(m) + ':' + p(r) : m + ':' + p(r);
  },
  formatPitch(n) {
    if (n === 0) return '±0';
    return n > 0 ? '+' + n : '−' + Math.abs(n);
  },
  formatSpeed(x) {
    return x.toFixed(2) + '倍';
  },
  formatMB(bytes) {
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
  },

  clamp(x, min, max) {
    return Math.min(max, Math.max(min, x));
  },
  roundStep(x, step) {
    return Number((Math.round(x / step) * step).toFixed(2));
  },
  // スライダーの段階の番号（-3〜3）⇔ 速度
  speedFromLevel(n) {
    return Util.roundStep(1 + KE.SPEED_STEP * n, KE.SPEED_STEP);
  },
  levelFromSpeed(x) {
    return Math.round((x - 1) / KE.SPEED_STEP);
  },

  makeSongId(name, size) {
    return name + '|' + size;
  },
  getExt(name) {
    const i = name.lastIndexOf('.');
    return i < 0 ? '' : name.slice(i + 1).toLowerCase();
  },
  stripExt(name) {
    const i = name.lastIndexOf('.');
    return i <= 0 ? name : name.slice(0, i);
  },

  // 記録のID：'r' + 開始時刻 + '-' + 連番 + '-' + 乱数3文字（同じ時刻でも重ならない）
  makeRecordId() {
    Util.seq_ += 1;
    const rnd = Math.random().toString(36).slice(2, 5).padEnd(3, '0');
    return 'r' + Date.now() + '-' + Util.seq_ + '-' + rnd;
  },

  // 「たった今」「5分前」「3時間前」「昨日」「3日前」
  formatAgo(ms) {
    if (!ms) return '';
    const now = Date.now();
    const diff = now - ms;
    if (diff < 60000) return 'たった今';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分前';
    const dayOf = (t) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
    const days = Math.round((dayOf(now) - dayOf(ms)) / 86400000);
    if (days <= 0) return Math.floor(diff / 3600000) + '時間前';
    if (days === 1) return '昨日';
    return days + '日前';
  },

  // 1秒の無音WAV（iPhoneに「再生中のアプリ」と認めさせ続けるため。KElástico仕様書 v0.2.5 第10-1節）
  makeSilentWavUrl() {
    const sr = 8000, n = sr, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true);
    v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  },

  // localStorage（使えない環境でも落ちない）
  lsGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  },
  lsSet(key, value) {
    try { window.localStorage.setItem(key, String(value)); return true; } catch (e) { return false; }
  },
  lsRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* 何もしない */ }
  },
  lsGetNum(key, def) {
    const v = Number(Util.lsGet(key));
    return isFinite(v) && Util.lsGet(key) !== null && Util.lsGet(key) !== '' ? v : def;
  },
};
