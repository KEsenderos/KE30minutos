// KE30minutos  app.js  版 0.4.1  基づく仕様書：KE30minutos_仕様書_v0.4.1.md
// 役割：起動処理、更新ボタン（ルールブック3-12）、起動時の確認（読み込み中に落ちた／途中で終了した再生）
const App = {
  swRegistration: null,
  lastUpdateCheck: 0,
  updateRequested: false,
  dbOk: false,

  async start() {
    UI.init();
    this.dbOk = await Store.open();
    if (!this.dbOk) {
      UI.showError(new KeError('DB'));
      UI.setAddEnabled(false);
    }
    this.checkLoadingFlag_();
    if (this.dbOk) {
      try { await Library.refresh(); } catch (e) { /* 空のまま */ }
      try { await Records.refresh(); } catch (e) { /* 空のまま */ }
      await this.checkProgress_();
    }
    Player.init();
    Session.init();
    MediaCtl.init();
    UI.switchTab('play');                  // 最後に開いたタブは覚えない。必ず再生タブ（FR-35）
    UI.render();
    this.initUpdateNotice();
    document.addEventListener('visibilitychange', () => this.onVisibility_());
    window.addEventListener('pagehide', () => { Player.flushSave(); Session.saveProgress_(); });
    Sync.request('launch');
  },

  // 起動時：前回、曲の読み込み中にアプリが終わっていた
  checkLoadingFlag_() {
    const id = Util.lsGet(KE.LS.LOADING);
    if (!id) return;
    Util.lsRemove(KE.LS.LOADING);
    const name = Util.stripExt(String(id).split('|')[0]);
    UI.showMessage(Util.fill(TEXT.INFO_CRASHED, { name }), 'warn');
  },

  // 起動時：前回、再生の途中で終わっていたら、その分の記録を復元する（11-11）
  async checkProgress_() {
    const raw = Util.lsGet(KE.LS.PROGRESS);
    if (!raw) return;
    let p = null;
    try { p = JSON.parse(raw); } catch (e) { p = null; }
    const ok = p && typeof p === 'object' && isFinite(p.startedAt) && isFinite(p.targetSec) && isFinite(p.elapsedSec);
    if (!ok) { Util.lsRemove(KE.LS.PROGRESS); return; }
    if (p.elapsedSec < KE.RECORD_MIN_SEC) { Util.lsRemove(KE.LS.PROGRESS); return; }
    const playSec = Math.round(p.elapsedSec);
    try {
      await Records.add({
        date: RecordsCore.dayStr(p.startedAt, KE.DAY_START_HOUR), startedAt: p.startedAt, playSec, targetSec: p.targetSec,
        songCount: Math.max(0, Math.round(Number(p.songCount) || 0)),
        completed: RecordsCore.isCompleted(playSec, p.targetSec), source: 'recovered',
      });
      Util.lsRemove(KE.LS.PROGRESS);
      UI.showMessage(Util.fill(TEXT.INFO_REC_RECOVERED, { play: RecordsCore.formatDuration(playSec) }), 'info');
    } catch (e) {
      UI.showError(e instanceof KeError ? e : Store.toKeError(e));      // PROGRESS は残して、次の起動でやり直す
    }
  },

  onVisibility_() {
    if (document.visibilityState === 'hidden') {
      Player.flushSave();
      Session.saveProgress_();
      return;
    }
    // 前面に戻った
    DriveImport.onVisible();
    UI.renderSyncStatus();
    UI.renderBackupWarn();
    if (Session.state === KE.STATE.PLAYING && Engine.ctx && Engine.ctx.state !== 'running') {
      Engine.ctx.resume().catch(() => {});
    }
    Sync.request('visible');
  },

  // ── 更新ボタン（ルールブック3-12のサンプルコードのとおり）──
  async initUpdateNotice() {
    if (!('serviceWorker' in navigator)) return;
    try {
      this.swRegistration = await navigator.serviceWorker.register('./sw.js');
    } catch (e) { return; }
    this.lastUpdateCheck = Date.now();
    const reg = this.swRegistration;
    if (reg.waiting && navigator.serviceWorker.controller) this.showUpdateButton_();
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) this.showUpdateButton_();
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!this.updateRequested) return;
      this.updateRequested = false;
      location.reload();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.checkForUpdate();
    });
    document.getElementById('update-btn').addEventListener('click', () => this.applyUpdate());
  },
  checkForUpdate() {
    if (!this.swRegistration) return;
    if (Date.now() - this.lastUpdateCheck < KE.UPDATE_CHECK_INTERVAL_MS) return;
    this.lastUpdateCheck = Date.now();
    this.swRegistration.update().catch(() => {});       // 電波が無いときは何もしない
  },
  showUpdateButton_() {
    document.getElementById('update-btn').hidden = false;
  },
  applyUpdate() {
    document.getElementById('update-btn').hidden = true;
    const waiting = this.swRegistration && this.swRegistration.waiting;
    if (waiting) {
      this.updateRequested = true;
      waiting.postMessage({ type: 'SKIP_WAITING' });
    } else {
      location.reload();
    }
  },
};

document.addEventListener('DOMContentLoaded', () => { App.start(); });
