// KE30minutos  drive.js  版 0.4.1  基づく仕様書：KE30minutos_仕様書_v0.4.1.md
// 役割：中継役（GAS「KE30minutos中継」）との通信。URL・合言葉の保存。失敗は例外にせず { ok:false, code } で返す（仕様書 第11-16節）
const Drive = {
  getSettings() {
    return { url: (Util.lsGet(KE.LS.GAS_URL) || '').trim(), key: (Util.lsGet(KE.LS.GAS_KEY) || '').trim() };
  },
  validUrl_(url) {
    return typeof url === 'string' && url.indexOf(KE.GAS_URL_PREFIX) === 0 && url.length > KE.GAS_URL_PREFIX.length + KE.GAS_URL_SUFFIX.length
      && url.slice(-KE.GAS_URL_SUFFIX.length) === KE.GAS_URL_SUFFIX;
  },
  saveSettings(url, key) {
    url = (url || '').trim(); key = (key || '').trim();
    if (!url || !key) return { ok: false, code: 'NO_SETTINGS' };
    if (!this.validUrl_(url)) return { ok: false, code: 'BAD_URL' };
    if (!Util.lsSet(KE.LS.GAS_URL, url) || !Util.lsSet(KE.LS.GAS_KEY, key)) return { ok: false, code: 'NO_SETTINGS' };
    return { ok: true };
  },
  isReady() {
    const s = this.getSettings();
    return !!(s.url && s.key);
  },

  // 1回の通信。合言葉は本文にだけ入れる（URLに付けない）。headers を付けない（本文は text/plain になり、事前確認の通信が出ない）
  async once_(action, params, timeoutMs) {
    const s = this.getSettings();
    if (!s.url || !s.key) return { ok: false, code: 'NO_SETTINGS' };
    if (!this.validUrl_(s.url)) return { ok: false, code: 'BAD_URL' };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let text;
    let status = 0;
    try {
      const r = await fetch(s.url, { method: 'POST', body: JSON.stringify(Object.assign({ key: s.key, action }, params || {})), signal: ctrl.signal });
      status = r.status;
      text = await r.text();
    } catch (e) {
      clearTimeout(timer);
      return { ok: false, code: (e && e.name === 'AbortError') ? 'TIMEOUT' : 'NETWORK' };
    }
    clearTimeout(timer);
    try {
      const o = JSON.parse(text);
      if (o && typeof o === 'object') return o;
      throw new Error('not object');
    } catch (e) {
      const brief = String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
      return { ok: false, code: 'NOT_JSON', message: 'HTTP ' + status + ' ' + brief };
    }
  },
  // NETWORK・TIMEOUT は、list・audio・sync のときだけ1回だけやり直す（putSync は自動では繰り返さない）
  async call_(action, params, opts) {
    const timeoutMs = (opts && opts.timeoutMs) || (action === 'audio' ? KE.DRIVE_AUDIO_TIMEOUT_MS : KE.DRIVE_TIMEOUT_MS);
    let res = await this.once_(action, params, timeoutMs);
    if (!res.ok && (res.code === 'NETWORK' || res.code === 'TIMEOUT') && action !== 'putSync') {
      res = await this.once_(action, params, timeoutMs);
    }
    return res;
  },

  async list() {
    const r = await this.call_('list', {});
    if (!r.ok) return r;
    return { ok: true, main: r.main || { found: false, files: [] }, last: r.last || { found: false, files: [] } };
  },

  // 曲を4MBずつ受け取ってつなぎ、Fileにする
  async fetchSong(fileId, opts) {
    opts = opts || {};
    const chunks = [];
    let total = 0;
    let parts = 1;
    let name = '';
    for (let part = 0; part < parts; part++) {
      if (opts.shouldCancel && opts.shouldCancel()) return { ok: false, code: 'CANCELLED' };
      const r = await this.call_('audio', { fileId, part }, { timeoutMs: KE.DRIVE_AUDIO_TIMEOUT_MS });
      if (!r.ok) return r;
      parts = r.parts || 1;
      name = r.name || name;
      let bin;
      try { bin = atob(r.data || ''); } catch (e) { return { ok: false, code: 'NOT_JSON', message: 'base64' }; }
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      chunks.push(u8);
      total += u8.length;
      if (opts.onProgress) opts.onProgress(part + 1, parts);
    }
    if (opts.expectedSize != null && total !== opts.expectedSize) return { ok: false, code: 'SIZE_MISMATCH' };
    const type = Util.getExt(name) === 'm4a' ? 'audio/mp4' : 'audio/mpeg';
    return { ok: true, file: new File(chunks, name, { type }) };
  },

  async getSync() {
    const r = await this.call_('sync', {});
    if (!r.ok) return r;
    return { ok: true, sync: r.sync === undefined ? null : r.sync };
  },
  // 返り値：{ ok:true, savedAt }／{ ok:false, code:'CONFLICT', sync }／その他の失敗
  async putSync(baseSavedAt, wire) {
    return await this.call_('putSync', { baseSavedAt, data: wire });
  },

  errorText(res) {
    const c = res && res.code;
    switch (c) {
      case 'BAD_KEY': return TEXT.ERR_DRIVE_BAD_KEY;
      case 'NETWORK': return TEXT.ERR_DRIVE_NETWORK;
      case 'TIMEOUT': return TEXT.ERR_DRIVE_TIMEOUT;
      case 'NOT_JSON': return Util.fill(TEXT.ERR_DRIVE_NOT_JSON, { detail: res.message || '' });
      case 'NO_SETTINGS': return TEXT.DRIVE_NEED_SETTINGS;
      case 'BAD_URL': return TEXT.ERR_DRIVE_BAD_URL;
      case 'NO_FOLDER': return Util.fill(TEXT.ERR_DRIVE_NO_FOLDER, { name: 'KE30minutos' });
      case 'DUPLICATE_FOLDER': return Util.fill(TEXT.ERR_DRIVE_DUP_FOLDER, { name: res.name || '' });
      case 'NO_FILE': return Util.fill(TEXT.ERR_DRIVE_FILE_GONE, { name: res.name || '' });
      case 'BUSY': return TEXT.ERR_DRIVE_BUSY;
      case 'CONFLICT': return TEXT.ERR_SYNC_CONFLICT;
      default: return Util.fill(TEXT.ERR_DRIVE_OTHER, { code: c || '?' });
    }
  },
};
