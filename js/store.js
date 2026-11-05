// KE30minutos  store.js  版 0.4.1  基づく仕様書：KE30minutos_仕様書_v0.4.1.md
// 役割：IndexedDB（曲・曲のファイル・記録・削除の印）の読み書き。書き込みは、まとまりごとに1回の書き込み（トランザクション）で行う。

const Store = {
  db: null,

  async open() {
    try {
      this.db = await this.openDb_();
      return true;
    } catch (e) {
      this.db = null;
      return false;
    }
  },

  openDb_() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('no indexedDB')); return; }
      const req = indexedDB.open(KE.DB_NAME, KE.DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'songId' });
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'songId' });
        if (!db.objectStoreNames.contains('records')) {
          const rs = db.createObjectStore('records', { keyPath: 'recordId' });
          rs.createIndex('date', 'date', { unique: false });
        }
        if (!db.objectStoreNames.contains('removed')) db.createObjectStore('removed', { keyPath: 'recordId' });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
  },

  // 1回の書き込み。fn(tx) の中で要求を出し、全部終わったら resolve
  tx_(storeNames, mode, fn) {
    return new Promise((resolve, reject) => {
      if (!this.db) { reject(new KeError('DB')); return; }
      let tx;
      try { tx = this.db.transaction(storeNames, mode); } catch (e) { reject(e); return; }
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('abort'));
      try { result = fn(tx); } catch (e) { try { tx.abort(); } catch (e2) { /* 何もしない */ } reject(e); }
    });
  },

  reqValue_(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  toKeError(err) {
    if (err instanceof KeError) return err;
    const name = err && (err.name || (err.target && err.target.error && err.target.error.name));
    if (name === 'QuotaExceededError') return new KeError('QUOTA');
    return new KeError('DB');
  },

  // 欠けた項目を既定値で補い、範囲に丸める
  normalizeSong_(rec) {
    const s = Object.assign({}, rec);
    s.schema = KE.SONG_SCHEMA;
    s.durationSec = typeof s.durationSec === 'number' && isFinite(s.durationSec) ? s.durationSec : 0;
    s.durationSrc = s.durationSrc === 'decoded' ? 'decoded' : 'meta';
    s.pitch = Util.clamp(Math.round(typeof s.pitch === 'number' ? s.pitch : 0), KE.PITCH_MIN, KE.PITCH_MAX);
    s.speed = Util.clamp(Util.roundStep(typeof s.speed === 'number' ? s.speed : 1, KE.SPEED_STEP), KE.SPEED_MIN, KE.SPEED_MAX);
    s.paramsAt = typeof s.paramsAt === 'number' ? s.paramsAt : 0;
    s.inMain = s.inMain === true;
    s.inLast = s.inLast === true;
    s.addedAt = typeof s.addedAt === 'number' ? s.addedAt : 0;
    s.lastPlayedAt = typeof s.lastPlayedAt === 'number' ? s.lastPlayedAt : null;
    s.updatedAt = typeof s.updatedAt === 'number' ? s.updatedAt : 0;
    s.type = s.type || '';
    return s;
  },

  // ---- 曲 ----
  async getAllSongs() {
    const list = await this.tx_(['songs'], 'readonly', (tx) => this.reqValue_(tx.objectStore('songs').getAll()));
    return (await list).map((r) => this.normalizeSong_(r));
  },
  async getSong(songId) {
    const r = await this.tx_(['songs'], 'readonly', (tx) => this.reqValue_(tx.objectStore('songs').get(songId)));
    const v = await r;
    return v ? this.normalizeSong_(v) : null;
  },
  async getFileBlob(songId) {
    const r = await this.tx_(['files'], 'readonly', (tx) => this.reqValue_(tx.objectStore('files').get(songId)));
    const v = await r;
    return v ? v.blob : null;
  },

  // 新しい曲をファイルごと保存（1回の書き込み）。以前消した曲の記録があれば、キー・速度・長さを引き継ぐ
  async putSongsWithFiles(list) {
    try {
      await this.tx_(['songs', 'files'], 'readwrite', (tx) => {
        const ss = tx.objectStore('songs');
        const fs = tx.objectStore('files');
        list.forEach(({ song, blob }) => {
          const get = ss.get(song.songId);
          get.onsuccess = () => {
            const old = get.result;
            const merged = Object.assign({}, song);
            if (old) {
              merged.pitch = old.pitch; merged.speed = old.speed; merged.paramsAt = old.paramsAt || 0;
              if (old.durationSec > 0 && !(song.durationSec > 0)) merged.durationSec = old.durationSec;
              merged.inMain = song.inMain || old.inMain === true;
              merged.inLast = song.inLast || old.inLast === true;
            }
            ss.put(this.normalizeSong_(merged));
            fs.put({ songId: song.songId, blob });
          };
        });
      });
    } catch (e) { throw this.toKeError(e); }
  },

  // キー・速度の保存。値が変わるときだけ paramsAt と updatedAt を更新する。変わったら true
  async updateSongSettings(songId, pitch, speed) {
    return await this.tx_(['songs'], 'readwrite', (tx) => {
      const ss = tx.objectStore('songs');
      const out = { changed: false };
      const get = ss.get(songId);
      get.onsuccess = () => {
        const s = get.result;
        if (!s) return;
        if (s.pitch === pitch && s.speed === speed) return;
        s.pitch = pitch; s.speed = speed; s.paramsAt = Date.now(); s.updatedAt = s.paramsAt;
        ss.put(s);
        out.changed = true;
      };
      return out;
    }).then((o) => o.changed);
  },
  // 長さ・最後に読んだ時刻など（paramsAt は変えない）
  async updateSongMeta(songId, fields) {
    await this.tx_(['songs'], 'readwrite', (tx) => {
      const ss = tx.objectStore('songs');
      const get = ss.get(songId);
      get.onsuccess = () => {
        const s = get.result;
        if (!s) return;
        Object.assign(s, fields);
        s.updatedAt = Date.now();
        ss.put(s);
      };
    });
  },
  // 一覧の印を変える。両方偽ならファイルも消す（設定は残す）。1回の書き込み
  async setMembership(songId, flags) {
    try {
      await this.tx_(['songs', 'files'], 'readwrite', (tx) => {
        const ss = tx.objectStore('songs');
        const get = ss.get(songId);
        get.onsuccess = () => {
          const s = get.result;
          if (!s) return;
          if (typeof flags.inMain === 'boolean') s.inMain = flags.inMain;
          if (typeof flags.inLast === 'boolean') s.inLast = flags.inLast;
          s.updatedAt = Date.now();
          ss.put(s);
          if (!s.inMain && !s.inLast) tx.objectStore('files').delete(songId);
        };
      });
    } catch (e) { throw this.toKeError(e); }
  },
  // バックアップの読み込み：同じ songId が無いときだけ、「消した曲」（両方偽）として足す。足した数を返す
  async putSongSettingsIfAbsent(list) {
    let added = 0;
    await this.tx_(['songs'], 'readwrite', (tx) => {
      const ss = tx.objectStore('songs');
      list.forEach((s) => {
        const get = ss.get(s.songId);
        get.onsuccess = () => {
          if (get.result) return;
          ss.put(this.normalizeSong_(Object.assign({}, s, { inMain: false, inLast: false, addedAt: Date.now(), updatedAt: Date.now() })));
          added += 1;
        };
      });
    });
    return added;
  },

  // ---- 記録 ----
  async getAllRecords() {
    return await (await this.tx_(['records'], 'readonly', (tx) => this.reqValue_(tx.objectStore('records').getAll())));
  },
  async putRecord(rec) {
    try { await this.tx_(['records'], 'readwrite', (tx) => { tx.objectStore('records').put(rec); }); }
    catch (e) { throw this.toKeError(e); }
  },
  // 記録の削除と、削除の印の追加を、1回の書き込みで行う
  async deleteRecord(recordId) {
    await this.tx_(['records', 'removed'], 'readwrite', (tx) => {
      tx.objectStore('records').delete(recordId);
      tx.objectStore('removed').put({ recordId, deletedAt: Date.now() });
    });
  },
  // バックアップの読み込み：同じ recordId が無いものだけ足す。足した数を返す
  async putRecordsIfAbsent(list) {
    let added = 0;
    await this.tx_(['records'], 'readwrite', (tx) => {
      const rs = tx.objectStore('records');
      list.forEach((r) => {
        const get = rs.get(r.recordId);
        get.onsuccess = () => { if (!get.result) { rs.put(r); added += 1; } };
      });
    });
    return added;
  },
  async getAllRemoved() {
    return await (await this.tx_(['removed'], 'readonly', (tx) => this.reqValue_(tx.objectStore('removed').getAll())));
  },

  // 同期の差分を1回の書き込みで反映する（SyncCore.diff の結果）。SYNC_DIRTY は付けない
  async applySync(df) {
    await this.tx_(['records', 'removed', 'songs'], 'readwrite', (tx) => {
      const rs = tx.objectStore('records');
      const ds = tx.objectStore('removed');
      const ss = tx.objectStore('songs');
      df.putRecords.forEach((r) => rs.put(r));
      df.deleteIds.forEach((id) => rs.delete(id));
      df.putRemoved.forEach((x) => ds.put(x));
      df.dropRemovedIds.forEach((id) => ds.delete(id));
      df.putSongs.forEach((m) => {
        const get = ss.get(m.songId);
        get.onsuccess = () => {
          const old = get.result;
          if (old) {
            old.pitch = m.pitch; old.speed = m.speed; old.paramsAt = m.paramsAt;
            if (!(old.durationSec > 0) && m.durationSec > 0) old.durationSec = m.durationSec;
            old.updatedAt = Date.now();
            ss.put(this.normalizeSong_(old));
          } else {
            ss.put(this.normalizeSong_({
              songId: m.songId, name: m.name, size: m.size, type: '', durationSec: m.durationSec, durationSrc: 'meta',
              pitch: m.pitch, speed: m.speed, paramsAt: m.paramsAt, inMain: false, inLast: false,
              addedAt: Date.now(), lastPlayedAt: null, updatedAt: Date.now(),
            }));
          }
        };
      });
    });
  },
};
