// KE30minutos  library.js  版 0.4.1  基づく仕様書：KE30minutos_仕様書_v0.4.1.md
// 役割：曲の登録（メインの曲・ラストの曲）の追加・削除・入れ替え（仕様書 第11-1・11-8節）
const Library = {
  songs_: [],            // 登録している曲（inMain か inLast が真）。名前順

  async refresh() {
    const all = await Store.getAllSongs();
    this.songs_ = all.filter((s) => s.inMain || s.inLast).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    return this.songs_;
  },
  getAll() { return this.songs_; },
  getMain() { return this.songs_.filter((s) => s.inMain); },
  getLast() { return this.songs_.filter((s) => s.inLast); },
  find(songId) { return this.songs_.find((s) => s.songId === songId) || null; },
  count() { return this.songs_.length; },

  inList_(song, listKey) { return listKey === KE.LIST.LAST ? song.inLast : song.inMain; },

  // 曲の追加。戻り値 { added, errors:[{ code, name, detail }] }。opts.quiet が真なら画面に出さず返すだけ
  async addFiles(fileList, listKey, opts) {
    const quiet = !!(opts && opts.quiet);
    const files = Array.from(fileList || []);
    const errors = [];
    const toSave = [];          // [{ song, blob }]
    let flagOnly = 0;           // 印だけ変えた数
    const pendingIds = new Set();
    const key = listKey === KE.LIST.LAST ? 'inLast' : 'inMain';
    const fail = (code, name, detail) => errors.push({ code, name, detail: detail || {} });
    let libFull = false;

    for (const file of files) {
      if (libFull) break;
      const name = file.name;
      if (!KE.ALLOWED_EXT.includes(Util.getExt(name))) { fail('FORMAT', name); continue; }
      if (file.size > KE.MAX_FILE_BYTES) { fail('TOO_BIG', name, { mb: (file.size / 1024 / 1024).toFixed(1) }); continue; }
      const songId = Util.makeSongId(name, file.size);
      if (pendingIds.has(songId + '|' + key)) { fail('DUP', name); continue; }
      const existing = this.find(songId);
      if (existing && this.inList_(existing, listKey)) { fail('DUP', name); continue; }
      if (existing) {
        // 同じ曲が反対の一覧にだけある：ファイルは保存し直さず、印だけを真にする
        try {
          await Store.setMembership(songId, { [key]: true });
          flagOnly++;
          pendingIds.add(songId + '|' + key);
        } catch (e) { errors.push({ code: Store.toKeError(e).code, name, detail: {} }); }
        continue;
      }
      if (this.songs_.length + toSave.length >= KE.LIBRARY_MAX) { fail('LIB_FULL', name); libFull = true; continue; }
      // 新しい曲：長さを調べる
      let dur = await Engine.probeDuration(file);
      if (dur === null) {
        try { dur = await Engine.decodeDuration(file); } catch (e) { fail('DECODE', name); continue; }
      }
      if (dur > KE.MAX_DURATION_SEC) { fail('TOO_LONG', name, { min: Math.round(dur / 60) }); continue; }
      const now = Date.now();
      toSave.push({
        song: {
          schema: KE.SONG_SCHEMA, songId, name, size: file.size, type: file.type || '',
          durationSec: dur, durationSrc: 'meta', pitch: 0, speed: 1.0, paramsAt: 0,
          inMain: key === 'inMain', inLast: key === 'inLast',
          addedAt: now, lastPlayedAt: null, updatedAt: now,
        },
        blob: file,
      });
      pendingIds.add(songId + '|' + key);
    }

    let added = flagOnly;
    if (toSave.length) {
      try {
        await Store.putSongsWithFiles(toSave);
        added += toSave.length;
      } catch (e) {
        const ke = Store.toKeError(e);
        toSave.forEach((t) => errors.push({ code: ke.code, name: t.song.name, detail: {} }));
      }
    }
    await this.refresh();
    if (added > 0 && !Util.lsGet(KE.LS.PERSIST_ASKED)) {
      Util.lsSet(KE.LS.PERSIST_ASKED, '1');
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* 何もしない */ }
    }

    if (!quiet) {
      const lines = [];
      if (added > 0) lines.push(Util.fill(TEXT.INFO_ADDED, { n: added }));
      errors.forEach((er) => lines.push(UI.errorText(new KeError(er.code, er.detail), er.name)));
      if (errors.length) UI.showMessage(lines.join('\n'), 'error');
      else if (added > 0) UI.showMessage(lines.join('\n'), 'info');
      UI.renderSongs();
      UI.renderPlan();
    }
    return { added, errors: errors.map((er) => ({ code: er.code, name: er.name })) };
  },

  // 削除ボタンの2回目：その一覧から外す。両方の一覧から外れたらファイルも消える。再生中は何もしない（FR-17）
  async remove(songId, listKey) {
    if (this.isBusy_()) return false;
    const s = this.find(songId);
    if (!s) return false;
    const key = listKey === KE.LIST.LAST ? 'inLast' : 'inMain';
    try {
      await Store.setMembership(songId, { [key]: false });
    } catch (e) { UI.showError(Store.toKeError(e)); return false; }
    await this.refresh();
    UI.renderSongs();
    UI.renderPlan();
    return true;
  },

  // 反対の一覧にも入れる／から外す。入れるのは1回のタップ、外すのは2回押し（UI側）。外した結果両方偽ならファイルも消える
  async toggleOther(songId, listKey) {
    const s = this.find(songId);
    if (!s) return false;
    const otherKey = listKey === KE.LIST.LAST ? 'inMain' : 'inLast';
    const turningOn = !s[otherKey];
    if (!turningOn && this.isBusy_()) return false;
    try {
      await Store.setMembership(songId, { [otherKey]: turningOn });
    } catch (e) { UI.showError(Store.toKeError(e)); return false; }
    await this.refresh();
    UI.renderSongs();
    UI.renderPlan();
    return true;
  },

  // 再生中（LOADING・PLAYING・PAUSED）は、削除と「から外す」を押せない
  isBusy_() {
    const st = Session.state;
    return st === KE.STATE.LOADING || st === KE.STATE.PLAYING || st === KE.STATE.PAUSED;
  },
};
