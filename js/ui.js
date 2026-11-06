// KE30minutos  ui.js  版 0.5  基づく仕様書：KE30minutos_仕様書_v0.5.md
// 役割：画面の表示とボタンの受付（4つのタブ）。仕様書 第8章・第11-13節
const UI = {
  el: {},
  msgTimer_: null,
  armed_: null,              // 2回押しの待ち { key, until }
  armTimer_: null,
  lastRemainText_: '',
  lastPlanTitle_: '',
  lastTimeText_: '',
  tab: 'play',
  recY: 0,
  recM: 0,
  recSel: '',
  editingRecId_: null,       // 記録の修正中の recordId（追加のときは null）
  recFormOpen_: false,
  recFormOrig_: null,

  // ── 初期化 ──
  init() {
    const ids = [
      'appTitle', 'appVersion', 'update-btn', 'msgArea', 'remainLabel', 'remainValue', 'progressText', 'nowTitle', 'lastBadge', 'nowBadge',
      'seekBar', 'timeCur', 'timeTotal', 'btnStop', 'btnPlay', 'iconPlay', 'iconPause', 'btnNext', 'btnReset', 'playReady',
      'btnPitchDown', 'pitchValue', 'btnPitchUp', 'pitchSlider', 'btnSpeedDown', 'speedValue', 'btnSpeedUp', 'speedSlider',
      'planTitle', 'summaryText', 'planEmpty', 'planList',
      'listTotal', 'btnDriveOpen', 'drivePanel', 'btnDriveReload', 'btnDriveClose', 'driveNote2', 'driveMainTitle', 'driveMainList',
      'driveLastTitle', 'driveLastList', 'btnDriveAll', 'driveProgress', 'btnDriveCancel', 'driveResult',
      'listMainTitle', 'btnAddMain', 'fileInputMain', 'listMainEmpty', 'listMain',
      'listLastTitle', 'btnAddLast', 'fileInputLast', 'listLastEmpty', 'listLast', 'listLockNote',
      'recBackupWarn', 'btnRecPrev', 'recMonthLabel', 'btnRecNext', 'recSummary', 'recGrid', 'recDayTitle', 'recDayEmpty', 'recDayList',
      'btnRecAdd', 'recForm', 'recFormDate', 'recFormTarget', 'recFormPlay', 'recFormDone', 'recFormError', 'btnRecSave', 'btnRecCancel',
      'setBackupWarn', 'btnTargetDown', 'targetValue', 'btnTargetUp', 'targetNote',
      'inGasUrl', 'inGasKey', 'btnGasSave', 'btnSyncNow', 'syncLast', 'syncStatus', 'syncGuard', 'syncGuardText', 'btnSyncGuardOk', 'btnSyncGuardNo', 'driveNote',
      'btnDriveFolders', 'driveFolders', 'linkDriveMain', 'linkDriveLast', 'driveFoldersNote',
      'backupLast', 'btnBackupExport', 'btnBackupImport', 'fileInputBackup', 'backupNote', 'backupResult', 'appVersion2', 'howto',
    ];
    ids.forEach((id) => { this.el[id] = document.getElementById(id); });
    // 画面の文字
    document.querySelectorAll('[data-text]').forEach((n) => { n.textContent = TEXT[n.getAttribute('data-text')] || ''; });
    document.querySelectorAll('[data-aria]').forEach((n) => { n.setAttribute('aria-label', TEXT[n.getAttribute('data-aria')] || ''); });
    this.el.appTitle.textContent = TEXT.APP_TITLE;
    this.el.appVersion.textContent = Util.fill(TEXT.VERSION, { v: KE.APP_VERSION });
    this.el.appVersion2.textContent = Util.fill(TEXT.VERSION, { v: KE.APP_VERSION });
    this.el.remainLabel.textContent = TEXT.LABEL_REMAIN;
    this.el.planEmpty.textContent = TEXT.PLAN_EMPTY;
    this.el.targetNote.textContent = TEXT.TARGET_NOTE;
    this.el.driveNote.textContent = TEXT.DRIVE_NOTE;
    this.el.backupNote.textContent = TEXT.BACKUP_NOTE;
    this.el['update-btn'].textContent = TEXT.UPDATE_BANNER;
    this.el.howto.innerHTML = '';
    TEXT.HOWTO.forEach((t) => { const li = document.createElement('li'); li.textContent = t; this.el.howto.appendChild(li); });
    this.el.fileInputMain.accept = KE.ACCEPT_TYPES;
    this.el.fileInputLast.accept = KE.ACCEPT_TYPES;
    this.el.fileInputMain.multiple = true;
    this.el.fileInputLast.multiple = true;
    // 記録タブの初期の月・日
    const today = RecordsCore.dayStr(Date.now(), KE.DAY_START_HOUR);
    const p = today.split('-').map(Number);
    this.recY = p[0]; this.recM = p[1]; this.recSel = today;
    // ドライブの入力欄
    const gs = Drive.getSettings();
    this.el.inGasUrl.value = gs.url;
    this.bindEvents_();
    document.querySelectorAll('button').forEach((b) => this.bindPress_(b));
  },

  // 押した色（.pressed）。離した後も最低 PRESS_HOLD_MS は保つ
  bindPress_(el) {
    let t = null;
    const on = () => { if (el.disabled) return; el.classList.add('pressed'); if (t) { clearTimeout(t); t = null; } };
    const off = () => { if (t) clearTimeout(t); t = setTimeout(() => { el.classList.remove('pressed'); t = null; }, KE.PRESS_HOLD_MS); };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  },

  bindEvents_() {
    const e = this.el;
    const on = (id, ev, fn) => e[id].addEventListener(ev, fn);
    // タブ
    document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => this.switchTab(b.getAttribute('data-tab'))));
    // 帯
    on('msgArea', 'click', () => { if (!e.msgArea.classList.contains('info')) this.hideMessage(); });
    on('recBackupWarn', 'click', () => this.switchTab('settings'));
    on('setBackupWarn', 'click', () => this.switchTab('settings'));
    // 再生タブ（再生ボタンは、タップの中で Player.togglePlay を呼ぶ）
    on('btnPlay', 'click', () => Player.togglePlay());
    on('btnStop', 'click', () => Session.stop());
    on('btnNext', 'click', () => Session.next());
    on('btnReset', 'click', () => Player.resetParams());
    on('btnPitchDown', 'click', () => Player.changePitch(-KE.PITCH_STEP));
    on('btnPitchUp', 'click', () => Player.changePitch(KE.PITCH_STEP));
    on('btnSpeedDown', 'click', () => Player.changeSpeed(-KE.SPEED_STEP));
    on('btnSpeedUp', 'click', () => Player.changeSpeed(KE.SPEED_STEP));
    on('pitchSlider', 'input', () => Player.setPitch(Number(e.pitchSlider.value)));
    on('speedSlider', 'input', () => Player.setSpeed(Number(e.speedSlider.value)));
    // 曲タブ
    on('btnAddMain', 'click', () => e.fileInputMain.click());
    on('btnAddLast', 'click', () => e.fileInputLast.click());
    on('fileInputMain', 'change', async () => { const f = Array.from(e.fileInputMain.files); e.fileInputMain.value = ''; if (f.length) await Library.addFiles(f, KE.LIST.MAIN); });
    on('fileInputLast', 'change', async () => { const f = Array.from(e.fileInputLast.files); e.fileInputLast.value = ''; if (f.length) await Library.addFiles(f, KE.LIST.LAST); });
    on('listMain', 'click', (ev) => this.onListClick_(ev, KE.LIST.MAIN));
    on('listLast', 'click', (ev) => this.onListClick_(ev, KE.LIST.LAST));
    on('btnDriveOpen', 'click', () => DriveImport.open());
    on('btnDriveClose', 'click', () => DriveImport.close());
    on('btnDriveReload', 'click', () => DriveImport.refresh());
    on('btnDriveAll', 'click', () => DriveImport.importAll());
    on('btnDriveCancel', 'click', () => DriveImport.cancel());
    const driveClick = (ev, key) => {
      const b = ev.target.closest('.btn-drive-one');
      if (!b) return;
      ev.stopPropagation();
      const li = b.closest('.drive-row');
      DriveImport.importOne(li.getAttribute('data-file-id'), key);
    };
    on('driveMainList', 'click', (ev) => driveClick(ev, KE.LIST.MAIN));
    on('driveLastList', 'click', (ev) => driveClick(ev, KE.LIST.LAST));
    // 記録タブ
    on('btnRecPrev', 'click', () => this.moveMonth_(-1));
    on('btnRecNext', 'click', () => this.moveMonth_(1));
    on('recGrid', 'click', (ev) => {
      const b = ev.target.closest('.day-cell');
      if (!b || b.classList.contains('blank')) return;
      this.recSel = b.getAttribute('data-date');
      this.closeRecordForm();
      this.renderRecords();
    });
    on('recDayList', 'click', (ev) => this.onRecordClick_(ev));
    on('btnRecAdd', 'click', () => this.openRecordForm(null));
    on('btnRecCancel', 'click', () => this.closeRecordForm());
    on('btnRecSave', 'click', () => this.saveRecordForm_());
    const autoDone = () => {
      const t = Number(e.recFormTarget.value), p = Number(e.recFormPlay.value);
      if (e.recFormTarget.value !== '' && e.recFormPlay.value !== '' && isFinite(t) && isFinite(p)) e.recFormDone.checked = p * 60 >= t * 60;
    };
    on('recFormTarget', 'input', autoDone);
    on('recFormPlay', 'input', autoDone);
    // 設定タブ
    on('btnTargetDown', 'click', () => this.changeTarget_(-KE.TARGET_MIN_STEP));
    on('btnTargetUp', 'click', () => this.changeTarget_(KE.TARGET_MIN_STEP));
    on('btnGasSave', 'click', () => this.saveGas_());
    on('btnSyncNow', 'click', () => Sync.request('manual'));
    on('btnDriveFolders', 'click', () => this.toggleDriveFolders_());
    on('btnSyncGuardOk', 'click', () => Sync.onGuardOk());
    on('btnSyncGuardNo', 'click', () => Sync.onGuardNo());
    on('btnBackupExport', 'click', () => Backup.exportAll());
    on('btnBackupImport', 'click', () => e.fileInputBackup.click());
    on('fileInputBackup', 'change', async () => { const f = e.fileInputBackup.files[0]; e.fileInputBackup.value = ''; if (f) await Backup.importFile(f); });
  },

  // ── 全体 ──
  render() {
    this.renderNow();
    this.renderTransport();
    this.renderParams();
    this.renderPlan();
    this.renderSongs();
    this.renderSettings();
    this.renderRecords();
    this.renderBackup();
    this.renderBackupWarn();
    this.renderDrive();
  },
  renderNow() { this.renderNow_(); this.renderPosition(); },

  isActive_() { return Session.state === KE.STATE.PLAYING || Session.state === KE.STATE.PAUSED; },
  isPlayingAny_() { const s = Session.state; return s === KE.STATE.LOADING || s === KE.STATE.PLAYING || s === KE.STATE.PAUSED; },

  renderNow_() {
    const e = this.el;
    const st = Session.state;
    let title = '';
    if (st === KE.STATE.IDLE) title = TEXT.NOW_IDLE;
    else if (st === KE.STATE.FINISHED) title = TEXT.NOW_FINISHED;
    else if (st === KE.STATE.LOADING) title = TEXT.NOW_LOADING;
    else title = Player.song ? Util.stripExt(Player.song.name) : '';
    e.nowTitle.textContent = title;
    const showLast = this.isActive_() && Session.isOnLast_();
    e.lastBadge.hidden = !showLast;
    e.lastBadge.textContent = TEXT.BADGE_LAST;
    e.nowBadge.textContent = this.isActive_() ? Util.fill(TEXT.SETTING_BADGE, { p: Util.formatPitch(Player.pitch), s: Player.speed.toFixed(2) }) : '';
    e.progressText.textContent = this.isPlayingAny_() ? Util.fill(TEXT.PROGRESS, { i: Session.index + 1, n: Session.plan.length }) : '';
    if (st === KE.STATE.IDLE) {
      const min = Util.lsGetNum(KE.LS.TARGET_MIN, KE.TARGET_MIN_DEFAULT);
      e.playReady.hidden = false;
      e.playReady.textContent = Util.fill(TEXT.PLAY_READY, { min, max: min + KE.TOLERANCE_SEC / 60 });
    } else {
      e.playReady.hidden = true;
    }
    e.summaryText.hidden = st !== KE.STATE.FINISHED;
    e.summaryText.textContent = st === KE.STATE.FINISHED ? Session.summaryText : '';
    this.lastRemainText_ = '';
  },

  // 1秒ごとに変わる部分だけ書き換える
  renderPosition() {
    const e = this.el;
    const st = Session.state;
    let remain;
    if (st === KE.STATE.IDLE) remain = Util.formatTime(Util.lsGetNum(KE.LS.TARGET_MIN, KE.TARGET_MIN_DEFAULT) * 60);
    else if (st === KE.STATE.FINISHED) remain = Util.formatTime(0);
    else remain = Util.formatTime(Math.round(Session.remainingSec()));
    if (remain !== this.lastRemainText_) { this.lastRemainText_ = remain; e.remainValue.textContent = remain; }
    const hasSong = this.isActive_() && Player.duration > 0;
    const cur = hasSong ? Util.formatTime(Player.position) : '--:--';
    const tot = hasSong ? Util.formatTime(Player.duration) : '--:--';
    const tt = cur + '/' + tot;
    if (tt !== this.lastTimeText_) {
      this.lastTimeText_ = tt;
      e.timeCur.textContent = cur;
      e.timeTotal.textContent = tot;
      e.seekBar.value = hasSong ? String(Math.round((Player.position / Player.duration) * 1000)) : '0';
      this.setFill_(e.seekBar);
    }
    const planTitle = this.isPlayingAny_() ? Util.fill(TEXT.PLAN_TITLE, { total: Util.formatTime(Math.round(Session.elapsedSec + Session.remainingSec())) })
      : (st === KE.STATE.FINISHED ? Util.fill(TEXT.PLAN_TITLE, { total: Util.formatTime(Math.round(Session.elapsedSec)) }) : Util.fill(TEXT.PLAN_TITLE, { total: TEXT.PLAN_TOTAL_NONE }));
    if (planTitle !== this.lastPlanTitle_) { this.lastPlanTitle_ = planTitle; e.planTitle.textContent = planTitle; }
  },

  renderTransport() {
    const e = this.el;
    const st = Session.state;
    const loading = st === KE.STATE.LOADING;
    e.btnPlay.disabled = loading;
    e.iconPlay.style.display = st === KE.STATE.PLAYING ? 'none' : '';
    e.iconPause.style.display = st === KE.STATE.PLAYING ? '' : 'none';
    e.btnPlay.setAttribute('aria-label', loading ? TEXT.BTN_PLAY_ARIA_LOADING : (st === KE.STATE.PLAYING ? TEXT.ARIA_PAUSE : TEXT.ARIA_PLAY));
    e.btnStop.disabled = st === KE.STATE.IDLE || st === KE.STATE.FINISHED;
    e.btnNext.disabled = !this.isActive_();
    e.btnReset.disabled = !this.isActive_();
    e.btnDriveOpen.disabled = this.isPlayingAny_() || DriveImport.busy;
    e.btnSyncNow.disabled = this.isPlayingAny_() || Sync.state === 'running';
    e.btnBackupImport.disabled = this.isPlayingAny_();
    e.btnTargetDown.disabled = this.isPlayingAny_();
    e.btnTargetUp.disabled = this.isPlayingAny_();
  },

  renderParams() {
    const e = this.el;
    const act = this.isActive_();
    const pitch = act ? Player.pitch : 0;
    const speed = act ? Player.speed : 1.0;
    e.pitchValue.textContent = Util.formatPitch(pitch);
    e.speedValue.textContent = Util.formatSpeed(speed);
    e.pitchSlider.value = String(pitch);
    e.speedSlider.value = String(Util.levelFromSpeed(speed));
    this.setFill_(e.pitchSlider);
    this.setFill_(e.speedSlider);
    [e.btnPitchDown, e.btnPitchUp, e.btnSpeedDown, e.btnSpeedUp, e.pitchSlider, e.speedSlider].forEach((n) => { n.disabled = !act; });
  },

  // スライダーのつまみより左を色で塗る
  setFill_(el) {
    if (!el) return;
    const min = Number(el.min), max = Number(el.max), v = Number(el.value);
    const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
    el.style.setProperty('--fill', Util.clamp(pct, 0, 100).toFixed(2) + '%');
  },

  songName_(id) {
    const s = Library.find(id);
    return s ? Util.stripExt(s.name) : Util.stripExt(String(id).split('|')[0]);
  },
  renderPlan() {
    const e = this.el;
    const plan = Session.plan;
    e.planList.innerHTML = '';
    e.planEmpty.hidden = plan.length > 0;
    const st = Session.state;
    plan.forEach((it, i) => {
      const li = document.createElement('li');
      li.className = 'plan-row';
      li.setAttribute('data-song-id', it.id);
      if (st === KE.STATE.FINISHED ? i <= Session.index : i < Session.index) li.classList.add('done');
      if (i === Session.index && this.isPlayingAny_()) li.classList.add('now');
      if (it.isLast) li.classList.add('is-last');
      const no = document.createElement('span'); no.className = 'plan-no'; no.textContent = String(i + 1);
      const nm = document.createElement('span'); nm.className = 'plan-name'; nm.textContent = this.songName_(it.id);
      const tm = document.createElement('span'); tm.className = 'plan-time'; tm.textContent = Util.formatTime(Math.max(0, it.effSec - KE.GAP_SEC));
      li.appendChild(no); li.appendChild(nm); li.appendChild(tm);
      e.planList.appendChild(li);
    });
    this.lastPlanTitle_ = '';
    this.renderPosition();
  },

  // ── 曲タブ ──
  renderSongs() {
    const e = this.el;
    e.listTotal.textContent = Util.fill(TEXT.LIST_TOTAL, { n: Library.count(), max: KE.LIBRARY_MAX });
    const main = Library.getMain(), last = Library.getLast();
    e.listMainTitle.textContent = Util.fill(TEXT.LIST_MAIN_TITLE, { n: main.length });
    e.listLastTitle.textContent = Util.fill(TEXT.LIST_LAST_TITLE, { n: last.length });
    e.listMainEmpty.textContent = TEXT.LIST_EMPTY_MAIN;
    e.listLastEmpty.textContent = TEXT.LIST_EMPTY_LAST;
    e.listMainEmpty.hidden = main.length > 0;
    e.listLastEmpty.hidden = last.length > 0;
    this.fillSongList_(e.listMain, main, KE.LIST.MAIN);
    this.fillSongList_(e.listLast, last, KE.LIST.LAST);
    const busy = Library.isBusy_();
    e.listLockNote.hidden = !busy;
    e.listLockNote.textContent = TEXT.NOTE_LOCKED;
    this.renderTransport();
  },
  armKey_(action, listKey, songId) { return action + ':' + listKey + ':' + songId; },
  isArmed_(key) { return !!(this.armed_ && this.armed_.key === key && Date.now() < this.armed_.until); },
  fillSongList_(ul, songs, listKey) {
    ul.innerHTML = '';
    const busy = Library.isBusy_();
    songs.forEach((s) => {
      const li = document.createElement('li');
      li.className = 'song-row';
      li.setAttribute('data-song-id', s.songId);
      li.setAttribute('data-list', listKey);
      const nm = document.createElement('div'); nm.className = 'song-name'; nm.textContent = Util.stripExt(s.name);
      const info = document.createElement('div'); info.className = 'song-info';
      const badge = document.createElement('span'); badge.className = 'song-badge';
      badge.textContent = Util.fill(TEXT.SETTING_BADGE, { p: Util.formatPitch(s.pitch), s: s.speed.toFixed(2) });
      const tags = document.createElement('span'); tags.className = 'tags';
      if (s.inMain) { const t = document.createElement('span'); t.className = 'tag tag-main'; t.textContent = TEXT.TAG_MAIN; tags.appendChild(t); }
      if (s.inLast) { const t = document.createElement('span'); t.className = 'tag tag-last'; t.textContent = TEXT.TAG_LAST; tags.appendChild(t); }
      const tm = document.createElement('span'); tm.className = 'song-time'; tm.textContent = Util.formatTime(s.durationSec);
      info.appendChild(badge); info.appendChild(tags); info.appendChild(tm);
      const btns = document.createElement('div'); btns.className = 'song-btns';
      const otherOn = listKey === KE.LIST.MAIN ? s.inLast : s.inMain;
      const tog = document.createElement('button'); tog.type = 'button'; tog.className = 'btn-toggle';
      const togKey = this.armKey_('toggle', listKey, s.songId);
      const togArmed = otherOn && this.isArmed_(togKey);
      if (listKey === KE.LIST.MAIN) tog.textContent = otherOn ? TEXT.BTN_FROM_LAST : TEXT.BTN_TO_LAST;
      else tog.textContent = otherOn ? TEXT.BTN_FROM_MAIN : TEXT.BTN_TO_MAIN;
      if (togArmed) { tog.textContent = TEXT.BTN_DELETE_CONFIRM; tog.classList.add('armed'); }
      tog.disabled = otherOn && busy;
      const del = document.createElement('button'); del.type = 'button'; del.className = 'btn-delete';
      const delArmed = this.isArmed_(this.armKey_('delete', listKey, s.songId));
      del.textContent = delArmed ? TEXT.BTN_DELETE_CONFIRM : TEXT.BTN_DELETE;
      if (delArmed) del.classList.add('armed');
      del.disabled = busy;
      this.bindPress_(tog); this.bindPress_(del);
      btns.appendChild(tog); btns.appendChild(del);
      li.appendChild(nm); li.appendChild(info); li.appendChild(btns);
      ul.appendChild(li);
    });
  },
  arm_(key) {
    this.armed_ = { key, until: Date.now() + KE.DELETE_CONFIRM_MS };
    if (this.armTimer_) clearTimeout(this.armTimer_);
    this.armTimer_ = setTimeout(() => { this.armed_ = null; this.armTimer_ = null; this.renderSongs(); this.renderRecords(); }, KE.DELETE_CONFIRM_MS + 20);
  },
  disarm_() { this.armed_ = null; if (this.armTimer_) { clearTimeout(this.armTimer_); this.armTimer_ = null; } },
  async onListClick_(ev, listKey) {
    const b = ev.target.closest('button');
    if (!b) return;       // 曲の行をタップしても何も起きない
    ev.stopPropagation();
    const li = b.closest('.song-row');
    if (!li || b.disabled) return;
    const songId = li.getAttribute('data-song-id');
    const s = Library.find(songId);
    if (!s) return;
    if (b.classList.contains('btn-delete')) {
      const key = this.armKey_('delete', listKey, songId);
      if (!this.isArmed_(key)) { this.arm_(key); this.renderSongs(); return; }
      this.disarm_();
      await Library.remove(songId, listKey);
    } else if (b.classList.contains('btn-toggle')) {
      const otherOn = listKey === KE.LIST.MAIN ? s.inLast : s.inMain;
      if (!otherOn) { await Library.toggleOther(songId, listKey); return; }       // 入れるのは1回のタップ
      const key = this.armKey_('toggle', listKey, songId);
      if (!this.isArmed_(key)) { this.arm_(key); this.renderSongs(); return; }     // 外すのは2回押し
      this.disarm_();
      await Library.toggleOther(songId, listKey);
    }
  },

  // ── 設定タブ ──
  renderSettings() {
    const e = this.el;
    const min = Util.lsGetNum(KE.LS.TARGET_MIN, KE.TARGET_MIN_DEFAULT);
    e.targetValue.textContent = Util.fill(TEXT.TARGET_VALUE, { min });
    e.btnTargetDown.disabled = this.isPlayingAny_() || min <= KE.TARGET_MIN_MIN;
    e.btnTargetUp.disabled = this.isPlayingAny_() || min >= KE.TARGET_MIN_MAX;
    e.inGasKey.placeholder = Drive.getSettings().key ? TEXT.PW_SET_PLACEHOLDER : '';
    this.renderSyncStatus();
  },
  changeTarget_(delta) {
    if (this.isPlayingAny_()) return;
    const cur = Util.lsGetNum(KE.LS.TARGET_MIN, KE.TARGET_MIN_DEFAULT);
    const next = Util.clamp(cur + delta, KE.TARGET_MIN_MIN, KE.TARGET_MIN_MAX);
    if (next === cur) return;
    Util.lsSet(KE.LS.TARGET_MIN, next);
    Util.lsSet(KE.LS.TARGET_MIN_AT, Date.now());
    Sync.markDirty();
    Sync.request('change');
    this.renderSettings();
    this.renderNow();
  },
  renderDrive() { this.renderDrivePanel(); this.renderSyncStatus(); this.renderDriveFolders_(); },

  // ── ［このドライブを開く］（仕様書 第11-19節）──
  foldersOpen_: false,
  foldersBusy_: false,
  foldersNote_: '',
  async toggleDriveFolders_() {
    if (this.foldersOpen_) { this.foldersOpen_ = false; this.foldersNote_ = ''; this.renderDriveFolders_(); return; }
    this.foldersOpen_ = true;
    this.foldersNote_ = '';
    if (!Drive.isReady() || Drive.folderLinks()) { this.renderDriveFolders_(); return; }
    if (this.isPlayingAny_()) { this.foldersNote_ = TEXT.DRIVE_FOLDERS_LOCKED; this.renderDriveFolders_(); return; }
    this.foldersBusy_ = true;
    this.renderDriveFolders_();
    const res = await Drive.list();
    this.foldersBusy_ = false;
    if (!res.ok) {
      this.foldersNote_ = Drive.errorText(res);
    } else {
      const notes = [];
      let oldGas = false;
      [['main', KE.DRIVE_FOLDER_MAIN], ['last', KE.DRIVE_FOLDER_LAST]].forEach(([k, name]) => {
        if (!res[k].found) notes.push(Util.fill(TEXT.DRIVE_FOLDER_MISSING, { name }));
        else if (!Drive.validFolderUrl_(res[k].url)) oldGas = true;
      });
      if (oldGas) notes.push(TEXT.DRIVE_FOLDERS_OLD_GAS);
      this.foldersNote_ = notes.join(' ');
    }
    this.renderDriveFolders_();
  },
  renderDriveFolders_() {
    const e = this.el;
    if (!e.driveFolders) return;
    e.driveFolders.hidden = !this.foldersOpen_;
    e.btnDriveFolders.setAttribute('aria-expanded', this.foldersOpen_ ? 'true' : 'false');
    const links = Drive.isReady() ? Drive.folderLinks() : null;
    const setLink = (a, href) => {
      if (href) { a.href = href; a.hidden = false; } else { a.removeAttribute('href'); a.hidden = true; }
    };
    setLink(e.linkDriveMain, links && links.main);
    setLink(e.linkDriveLast, links && links.last);
    let note = '';
    if (!Drive.isReady()) note = TEXT.DRIVE_NEED_SETTINGS;
    else if (this.foldersBusy_) note = TEXT.DRIVE_FOLDERS_LOADING;
    else if (links) {
      const miss = [];
      if (!links.main) miss.push(Util.fill(TEXT.DRIVE_FOLDER_MISSING, { name: KE.DRIVE_FOLDER_MAIN }));
      if (!links.last) miss.push(Util.fill(TEXT.DRIVE_FOLDER_MISSING, { name: KE.DRIVE_FOLDER_LAST }));
      note = miss.join(' ');
    } else note = this.foldersNote_;
    e.driveFoldersNote.textContent = this.foldersOpen_ ? note : '';
  },
  renderSyncStatus() {
    const e = this.el;
    if (!e.syncLast) return;
    if (!Drive.isReady()) e.syncLast.textContent = TEXT.DRIVE_NOT_SET;
    else {
      const last = Util.lsGetNum(KE.LS.LAST_SYNC, 0);
      e.syncLast.textContent = last ? Util.fill(TEXT.SYNC_LAST, { ago: Util.formatAgo(last) }) : TEXT.SYNC_NEVER;
    }
    e.syncStatus.textContent = Sync.status.text;
    e.syncStatus.className = 'status-line' + (Sync.status.kind === 'ok' ? ' ok' : Sync.status.kind === 'bad' ? ' bad' : '');
    e.btnSyncNow.disabled = this.isPlayingAny_() || Sync.state === 'running';
  },
  showSyncGuard(n) {
    this.el.syncGuard.hidden = false;
    this.el.syncGuardText.textContent = Util.fill(TEXT.WARN_SYNC_GUARD, { n });
  },
  hideSyncGuard() { this.el.syncGuard.hidden = true; },

  async saveGas_() {
    const e = this.el;
    const url = e.inGasUrl.value.trim();
    const typedKey = e.inGasKey.value.trim();
    const key = typedKey || Drive.getSettings().key;       // 合言葉は、押した時点の値を読む（空なら今の設定のまま）
    const r = Drive.saveSettings(url, key);
    if (!r.ok) {
      Sync.status = { kind: 'bad', text: Drive.errorText(r) };
      this.renderSyncStatus();
      return;
    }
    e.inGasKey.value = '';
    this.renderSettings();
    this.foldersNote_ = '';
    this.renderDriveFolders_();
    Sync.status = { kind: 'run', text: TEXT.SYNC_RUNNING };
    this.renderSyncStatus();
    const res = await Drive.list();
    this.renderDriveFolders_();
    if (res.ok) {
      Sync.status = { kind: 'ok', text: Util.fill(TEXT.INFO_DRIVE_CONNECTED, { m: res.main.files.length, l: res.last.files.length }) };
      this.renderSyncStatus();
      Sync.request('connect');
    } else {
      Sync.status = { kind: 'bad', text: Drive.errorText(res) };
      this.renderSyncStatus();
    }
  },

  // ── ドライブの取り込みパネル ──
  renderDrivePanel() {
    const e = this.el;
    if (!e.drivePanel) return;
    const di = DriveImport;
    e.drivePanel.hidden = !di.open_;
    e.driveNote2.textContent = di.note2_;
    e.btnDriveOpen.disabled = this.isPlayingAny_() || di.busy;
    e.btnDriveReload.disabled = di.busy || di.loading;
    const fill = (ul, titleEl, key, titleKey) => {
      const grp = di.items ? (key === KE.LIST.MAIN ? di.items.main : di.items.last) : { found: false, files: [] };
      titleEl.textContent = Util.fill(TEXT[titleKey], { n: grp.files.length });
      ul.innerHTML = '';
      grp.files.forEach((f) => {
        const st = di.songState_(f, key);
        const li = document.createElement('li');
        li.className = 'drive-row';
        li.setAttribute('data-file-id', f.fileId);
        li.setAttribute('data-song-id', Util.makeSongId(f.name, f.size));
        li.setAttribute('data-list', key);
        const nm = document.createElement('div'); nm.className = 'drive-name'; nm.textContent = Util.stripExt(f.name);
        const right = document.createElement('div');
        if (st === 'todo') {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'btn-drive-one'; b.textContent = TEXT.BTN_DRIVE_ONE; b.disabled = di.busy;
          this.bindPress_(b); right.appendChild(b);
        } else {
          const s = document.createElement('div'); s.className = 'drive-state ' + st;
          s.textContent = st === 'done' ? TEXT.DRIVE_STATE_DONE : Util.fill(TEXT.DRIVE_STATE_BIG, { max: KE.MAX_FILE_BYTES / 1024 / 1024 });
          right.appendChild(s);
        }
        const sz = document.createElement('div'); sz.className = 'drive-size'; sz.textContent = Util.formatMB(f.size);
        li.appendChild(nm); li.appendChild(right); li.appendChild(sz);
        ul.appendChild(li);
      });
    };
    fill(e.driveMainList, e.driveMainTitle, KE.LIST.MAIN, 'DRIVE_LIST_MAIN');
    fill(e.driveLastList, e.driveLastTitle, KE.LIST.LAST, 'DRIVE_LIST_LAST');
    const n = di.taskCount();
    e.btnDriveAll.textContent = Util.fill(TEXT.BTN_DRIVE_ALL, { n });
    e.btnDriveAll.disabled = di.busy || n === 0;
    e.btnDriveCancel.hidden = !di.busy;
    e.driveProgress.hidden = !di.busy || !di.progress;
    e.driveProgress.textContent = di.progress;
    e.driveResult.textContent = di.resultText;
  },

  // ── バックアップ ──
  renderBackup() {
    const last = Util.lsGetNum(KE.LS.LAST_BACKUP, 0);
    this.el.backupLast.textContent = last ? Util.fill(TEXT.BACKUP_LAST, { ago: Util.formatAgo(last) }) : TEXT.BACKUP_NEVER;
  },
  renderBackupWarn() {
    const t = Backup.warnState_();
    [this.el.recBackupWarn, this.el.setBackupWarn].forEach((n) => { n.hidden = !t; n.textContent = t || ''; });
  },
  setBackupResult(text, kind) {
    this.el.backupResult.textContent = text;
    this.el.backupResult.className = 'status-line' + (kind === 'error' ? ' bad' : ' ok');
  },

  // ── 記録タブ ──
  moveMonth_(d) {
    let m = this.recM + d, y = this.recY;
    if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
    this.recY = y; this.recM = m;
    this.closeRecordForm();
    this.renderRecords();
  },
  renderRecords() {
    const e = this.el;
    const recs = Records.getAll();
    const today = RecordsCore.dayStr(Date.now(), KE.DAY_START_HOUR);
    e.recMonthLabel.textContent = Util.fill(TEXT.REC_MONTH, { y: this.recY, m: this.recM });
    const sm = RecordsCore.monthSummary(recs, this.recY, this.recM);
    e.recSummary.textContent = Util.fill(TEXT.REC_SUMMARY, { done: sm.doneDays, total: RecordsCore.formatDuration(sm.totalSec), streak: RecordsCore.streakDays(recs, today) });
    // カレンダー
    e.recGrid.innerHTML = '';
    TEXT.WEEKDAYS.forEach((w) => { const d = document.createElement('div'); d.className = 'rec-wd'; d.textContent = w; e.recGrid.appendChild(d); });
    const first = new Date(this.recY, this.recM - 1, 1).getDay();
    const days = new Date(this.recY, this.recM, 0).getDate();
    for (let i = 0; i < first; i++) { const b = document.createElement('button'); b.type = 'button'; b.className = 'day-cell blank'; b.disabled = true; b.tabIndex = -1; e.recGrid.appendChild(b); }
    for (let d = 1; d <= days; d++) {
      const ds = this.recY + '-' + RecordsCore.pad2_(this.recM) + '-' + RecordsCore.pad2_(d);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'day-cell'; b.textContent = String(d); b.setAttribute('data-date', ds);
      const stt = RecordsCore.dayState(recs, ds);
      if (stt) b.classList.add(stt);
      if (ds === today) b.classList.add('today');
      if (ds === this.recSel) b.classList.add('selected');
      this.bindPress_(b);
      e.recGrid.appendChild(b);
    }
    this.renderRecordDay();
  },
  renderRecordDay() {
    const e = this.el;
    const recs = Records.getAll().filter((r) => r.date === this.recSel).sort((a, b) => a.startedAt - b.startedAt);
    const p = this.recSel.split('-').map(Number);
    const wd = TEXT.WEEKDAYS[new Date(p[0], p[1] - 1, p[2]).getDay()];
    e.recDayTitle.textContent = Util.fill(TEXT.REC_DAY_TITLE, { m: p[1], d: p[2], w: wd });
    e.recDayEmpty.textContent = TEXT.REC_NONE;
    e.recDayEmpty.hidden = recs.length > 0;
    e.recDayList.innerHTML = '';
    recs.forEach((r) => {
      const li = document.createElement('li');
      li.className = 'rec-row';
      li.setAttribute('data-record-id', r.recordId);
      const line = document.createElement('div'); line.className = 'rec-line';
      const tm = document.createElement('span'); tm.className = 'rec-time'; tm.textContent = Util.formatTime(r.playSec);
      const bd = document.createElement('span'); bd.className = 'badge' + (r.completed ? ' badge-done' : ''); bd.textContent = r.completed ? TEXT.BADGE_DONE : TEXT.BADGE_NOT;
      line.appendChild(tm); line.appendChild(bd);
      const sub = document.createElement('div'); sub.className = 'rec-sub';
      let txt = Util.fill(TEXT.REC_SUB, { target: Math.round(r.targetSec / 60), n: r.songCount });
      if (r.source === 'manual') txt += ' ・ ' + TEXT.TAG_MANUAL;
      else if (r.source === 'recovered') txt += ' ・ ' + TEXT.TAG_RECOVERED;
      if (r.edited) txt += ' ・ ' + TEXT.TAG_EDITED;
      sub.textContent = txt;
      const btns = document.createElement('div'); btns.className = 'rec-btns';
      const ed = document.createElement('button'); ed.type = 'button'; ed.className = 'btn-sub btn-rec-edit'; ed.textContent = TEXT.BTN_REC_EDIT;
      const del = document.createElement('button'); del.type = 'button'; del.className = 'btn-delete btn-rec-del';
      const armed = this.isArmed_('recdel:' + r.recordId);
      del.textContent = armed ? TEXT.BTN_DELETE_CONFIRM : TEXT.BTN_DELETE; del.style.marginLeft = '0';
      if (armed) del.classList.add('armed');
      this.bindPress_(ed); this.bindPress_(del);
      btns.appendChild(ed); btns.appendChild(del);
      li.appendChild(line); li.appendChild(sub); li.appendChild(btns);
      e.recDayList.appendChild(li);
    });
  },
  async onRecordClick_(ev) {
    const b = ev.target.closest('button');
    if (!b) return;
    const li = b.closest('.rec-row');
    const id = li.getAttribute('data-record-id');
    const rec = Records.getAll().find((r) => r.recordId === id);
    if (!rec) return;
    if (b.classList.contains('btn-rec-edit')) { this.openRecordForm(rec); return; }
    if (b.classList.contains('btn-rec-del')) {
      const key = 'recdel:' + id;
      if (!this.isArmed_(key)) { this.arm_(key); this.renderRecordDay(); return; }
      this.disarm_();
      try {
        await Records.remove(id);
        Sync.request('change');
      } catch (e) { this.showError(e instanceof KeError ? e : Store.toKeError(e)); }
      this.renderRecords();
      this.renderBackupWarn();
    }
  },
  openRecordForm(rec) {
    const e = this.el;
    this.recFormOpen_ = true;
    this.editingRecId_ = rec ? rec.recordId : null;
    this.recFormOrig_ = rec || null;
    e.recForm.hidden = false;
    e.recFormDate.value = rec ? rec.date : this.recSel;
    e.recFormTarget.value = rec ? String(Math.round(rec.targetSec / 60)) : String(Util.lsGetNum(KE.LS.TARGET_MIN, KE.TARGET_MIN_DEFAULT));
    e.recFormPlay.value = rec ? String(Math.round(rec.playSec / 60)) : '';
    e.recFormDone.checked = rec ? rec.completed : false;
    e.recFormError.hidden = true;
    e.btnRecAdd.hidden = true;
  },
  closeRecordForm() {
    this.recFormOpen_ = false;
    this.editingRecId_ = null;
    this.recFormOrig_ = null;
    this.el.recForm.hidden = true;
    this.el.btnRecAdd.hidden = false;
  },
  async saveRecordForm_() {
    const e = this.el;
    const today = RecordsCore.dayStr(Date.now(), KE.DAY_START_HOUR);
    // 入力欄の値は、押した時点で読む（iPhoneでは打った直後の change が起きないことがある）
    const f = {
      date: e.recFormDate.value,
      targetMin: e.recFormTarget.value === '' ? NaN : Number(e.recFormTarget.value),
      playMin: e.recFormPlay.value === '' ? NaN : Number(e.recFormPlay.value),
    };
    const bad = RecordsCore.validateForm(f, today);
    if (bad.length) {
      const names = { date: TEXT.LABEL_REC_DATE, target: TEXT.LABEL_REC_TARGET, play: TEXT.LABEL_REC_PLAY };
      e.recFormError.hidden = false;
      e.recFormError.textContent = Util.fill(TEXT.ERR_REC_INPUT, { fields: bad.map((k) => names[k]).join('、') });
      return;
    }
    const done = e.recFormDone.checked;
    const p = f.date.split('-').map(Number);
    const noon = new Date(p[0], p[1] - 1, p[2], 12, 0, 0).getTime();
    try {
      if (this.editingRecId_) {
        const o = this.recFormOrig_;
        await Records.update(Object.assign({}, o, {
          date: f.date, targetSec: f.targetMin * 60, playSec: RecordsCore.playSecFromInput(f.playMin, o.playSec),
          completed: done, startedAt: f.date !== o.date ? noon : o.startedAt, edited: o.source === 'manual' ? false : true,
        }));
      } else {
        await Records.add({ date: f.date, startedAt: noon, playSec: f.playMin * 60, targetSec: f.targetMin * 60, songCount: 0, completed: done, source: 'manual' });
      }
    } catch (err) {
      const ke = err instanceof KeError ? err : Store.toKeError(err);
      e.recFormError.hidden = false;
      e.recFormError.textContent = this.errorText(ke);
      return;
    }
    Sync.request('change');
    this.closeRecordForm();
    this.recSel = f.date;
    this.recY = p[0]; this.recM = p[1];
    this.renderRecords();
    this.renderBackupWarn();
  },

  // ── タブ ──
  switchTab(tabId) {
    if (!KE.TABS.includes(tabId)) return;
    this.tab = tabId;
    KE.TABS.forEach((t) => {
      const panel = document.getElementById('panel-' + t);
      if (panel) panel.hidden = t !== tabId;
    });
    document.querySelectorAll('.tab-btn').forEach((b) => b.setAttribute('aria-selected', b.getAttribute('data-tab') === tabId ? 'true' : 'false'));
    if (tabId === 'records') this.renderRecords();
    if (tabId === 'settings') { this.renderSettings(); this.renderBackup(); }
    try { window.scrollTo(0, 0); } catch (e) { /* 何もしない */ }
  },

  // ── お知らせ・エラー ──
  showMessage(text, kind) {
    const e = this.el.msgArea;
    kind = kind === 'warn' || kind === 'error' ? kind : 'info';
    e.className = 'msg-area ' + kind;
    e.textContent = text;
    e.hidden = false;
    if (this.msgTimer_) { clearTimeout(this.msgTimer_); this.msgTimer_ = null; }
    if (kind === 'info') this.msgTimer_ = setTimeout(() => this.hideMessage(), KE.MESSAGE_HIDE_MS);
  },
  hideMessage() {
    if (this.msgTimer_) { clearTimeout(this.msgTimer_); this.msgTimer_ = null; }
    this.el.msgArea.hidden = true;
    this.el.msgArea.textContent = '';
  },
  errorText(err, name) {
    const code = err && err.code;
    const tpl = TEXT['ERR_' + code] || TEXT.ERR_DB;
    const d = (err && err.detail) || {};
    const maxBy = { TOO_BIG: KE.MAX_FILE_BYTES / 1024 / 1024, LIB_FULL: KE.LIBRARY_MAX, TOO_LONG: KE.MAX_DURATION_SEC / 60, REC_FULL: KE.RECORDS_MAX };
    return Util.fill(tpl, { name: name || d.name || '', mb: d.mb, min: d.min, max: maxBy[code] });
  },
  showError(err, name) { this.showMessage(this.errorText(err, name), 'error'); },
  setAddEnabled(on) {
    this.el.btnAddMain.disabled = !on;
    this.el.btnAddLast.disabled = !on;
  },
};
