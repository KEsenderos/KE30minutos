// KE30minutos  driveimport.js  版 0.4.1  基づく仕様書：KE30minutos_仕様書_v0.4.1.md
// 役割：ドライブの曲を、1曲ずつ端末へ取り込む（一覧、状態、中止）。仕様書 第11-17節
const DriveImport = {
  busy: false,
  cancelRequested: false,
  items: null,                 // { main:{found, files:[{fileId,name,size}]}, last:{...} }（画面を開くたびに読み直す。保存しない）
  results: { ok: [], skipped: [] },
  progress: '',                // #driveProgress に出す文字
  note2_: '',                  // #driveNote2 に出す文字
  resultText: '',              // #driveResult に出す文字
  loading: false,
  open_: false,
  wake_: null,

  isBusy() { return this.busy; },

  // ── 開く・閉じる ──
  async open() {
    if (this.busy) return;
    if (Library.isBusy_()) { this.note2_ = TEXT.NOTE_DRIVE_LOCKED; UI.renderDrivePanel(); return; }
    if (!Drive.isReady()) { this.note2_ = TEXT.DRIVE_NEED_SETTINGS; UI.renderDrivePanel(); return; }
    this.open_ = true;
    this.note2_ = TEXT.NOTE_DRIVE_WIFI;
    this.resultText = TEXT.DRIVE_LOADING_LIST;
    UI.renderDrivePanel();
    await this.refresh();
  },
  close() {
    this.open_ = false;
    UI.renderDrivePanel();
  },
  async refresh() {
    if (this.busy) return;
    this.loading = true;
    this.resultText = TEXT.DRIVE_LOADING_LIST;
    UI.renderDrivePanel();
    const res = await Drive.list();
    this.loading = false;
    if (!res.ok) {
      this.items = null;
      this.resultText = Drive.errorText(res);
    } else {
      this.items = { main: res.main, last: res.last };
      const lines = [];
      if (!res.main.found) lines.push(Util.fill(TEXT.DRIVE_FOLDER_MISSING, { name: KE.DRIVE_FOLDER_MAIN }));
      if (!res.last.found) lines.push(Util.fill(TEXT.DRIVE_FOLDER_MISSING, { name: KE.DRIVE_FOLDER_LAST }));
      if (!res.main.files.length && !res.last.files.length) lines.push(TEXT.DRIVE_EMPTY);
      this.resultText = lines.join('\n');
    }
    UI.renderDrivePanel();
  },

  // ── 状態と仕事 ──
  // 行ごと（曲×一覧）の状態：'done' / 'big' / 'todo'
  songState_(file, listKey) {
    const s = Library.find(Util.makeSongId(file.name, file.size));
    if (s && (listKey === KE.LIST.LAST ? s.inLast : s.inMain)) return 'done';
    if (file.size > KE.MAX_FILE_BYTES) return 'big';
    return 'todo';
  },
  // 「未取り込み」の行を songId ごとにまとめる
  buildTasks_(items) {
    const map = new Map();
    [[KE.LIST.MAIN, items.main], [KE.LIST.LAST, items.last]].forEach(([key, grp]) => {
      grp.files.forEach((f) => {
        if (this.songState_(f, key) !== 'todo') return;
        const songId = Util.makeSongId(f.name, f.size);
        let t = map.get(songId);
        if (!t) { t = { songId, name: f.name, size: f.size, fileId: f.fileId, lists: [] }; map.set(songId, t); }
        t.lists.push(key);
      });
    });
    return Array.from(map.values());
  },
  taskCount() { return this.items ? this.buildTasks_(this.items).length : 0; },

  // ── 実行 ──
  async importAll() {
    if (this.busy || !this.items) return;
    await this.run_(this.buildTasks_(this.items));
  },
  async importOne(fileId, listKey) {
    if (this.busy || !this.items) return;
    const grp = listKey === KE.LIST.LAST ? this.items.last : this.items.main;
    const f = grp.files.find((x) => x.fileId === fileId);
    if (!f || this.songState_(f, listKey) !== 'todo') return;
    await this.run_([{ songId: Util.makeSongId(f.name, f.size), name: f.name, size: f.size, fileId: f.fileId, lists: [listKey] }]);
  },
  cancel() {
    if (!this.busy) return;
    this.cancelRequested = true;
  },

  async run_(tasks) {
    if (!tasks.length) return;
    this.busy = true;
    this.cancelRequested = false;
    this.results = { ok: [], skipped: [] };
    this.resultText = '';
    this.progress = '';
    await this.lockScreen_();
    UI.renderDrivePanel();
    UI.renderTransport();
    let stopText = '';
    let cancelled = false;
    for (let i = 0; i < tasks.length; i++) {
      if (this.cancelRequested) { cancelled = true; break; }
      const out = await this.importTask_(tasks[i], i + 1, tasks.length);
      if (out.cancelled) { cancelled = true; break; }
      if (out.stop) { stopText = out.stop; break; }
      if (out.skip) this.results.skipped.push(tasks[i].name + '（' + out.skip + '）');
      else this.results.ok.push(tasks[i].name);
      await Library.refresh();
      UI.renderSongs();
      UI.renderPlan();
      UI.renderDrivePanel();
    }
    this.progress = '';
    const lines = [];
    if (stopText) lines.push(stopText);
    if (cancelled) lines.push(Util.fill(TEXT.INFO_DRIVE_CANCELLED, { n: this.results.ok.length }));
    else if (!stopText) lines.push(Util.fill(TEXT.INFO_DRIVE_IMPORTED, { n: this.results.ok.length }));
    if (this.results.skipped.length) lines.push(Util.fill(TEXT.WARN_DRIVE_SKIPPED, { list: this.results.skipped.join('、') }));
    this.resultText = lines.join('\n');
    this.unlockScreen_();
    this.busy = false;
    this.cancelRequested = false;
    await Library.refresh();
    UI.renderSongs();
    UI.renderPlan();
    UI.renderDrivePanel();
    UI.renderTransport();
  },

  // 1つの仕事。戻り値 { ok:true } / { skip:理由 } / { stop:文字 } / { cancelled:true }
  async importTask_(task, i, n) {
    const reasonOf = (code) => TEXT['DRIVE_REASON_' + code] || code;
    const have = Library.find(task.songId);
    // 1. 端末にこの曲のファイルがすでにある → 足りない一覧の印だけを真にする
    if (have && (have.inMain || have.inLast)) {
      try {
        for (const key of task.lists) await Store.setMembership(task.songId, { [key === KE.LIST.LAST ? 'inLast' : 'inMain']: true });
      } catch (e) { return { stop: UI.errorText(Store.toKeError(e), task.name) }; }
      return { ok: true };
    }
    // 2. ドライブから受け取る
    this.progress = Util.fill(TEXT.DRIVE_PROGRESS, { i, n, name: task.name, p: 0, ps: '?' });
    UI.renderDrivePanel();
    const res = await Drive.fetchSong(task.fileId, {
      expectedSize: task.size,
      shouldCancel: () => this.cancelRequested,
      onProgress: (p, ps) => {
        this.progress = Util.fill(TEXT.DRIVE_PROGRESS, { i, n, name: task.name, p, ps });
        UI.renderDrivePanel();
      },
    });
    if (!res.ok) {
      if (res.code === 'CANCELLED') return { cancelled: true };
      if (res.code === 'NO_FILE' || res.code === 'SIZE_MISMATCH') return { skip: reasonOf(res.code) };
      return { stop: Drive.errorText(Object.assign({ name: task.name }, res)) };
    }
    // 3. 足りない一覧の順に追加（手で追加するときと同じ処理）
    let saved = false;
    for (const key of task.lists) {
      const r = await Library.addFiles([res.file], key, { quiet: true });
      const er = r.errors.find((e) => e.code !== 'DUP');
      if (er) {
        if (er.code === 'QUOTA' || er.code === 'LIB_FULL' || er.code === 'DB') return { stop: UI.errorText(new KeError(er.code, {}), task.name) };
        return { skip: reasonOf(er.code) };
      }
      saved = saved || r.added > 0;
    }
    return saved ? { ok: true } : { ok: true };
  },

  // ── 画面を点けたままにする ──
  async lockScreen_() {
    try { if (navigator.wakeLock && navigator.wakeLock.request) this.wake_ = await navigator.wakeLock.request('screen'); } catch (e) { this.wake_ = null; }
  },
  unlockScreen_() {
    try { if (this.wake_) this.wake_.release(); } catch (e) { /* 何もしない */ }
    this.wake_ = null;
  },
  // 裏から戻ったとき、取り込み中なら取り直す
  onVisible() { if (this.busy) this.lockScreen_(); },
};
