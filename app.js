import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  onSnapshot,
  deleteField,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';

(() => {
  'use strict';

  const firebaseConfig = {
    apiKey: 'AIzaSyAGzuk4OwYWvWTLrgl7t-_a_S4RgLevZos',
    authDomain: 'chief-officer-rotation-planner.firebaseapp.com',
    projectId: 'chief-officer-rotation-planner',
    storageBucket: 'chief-officer-rotation-planner.firebasestorage.app',
    messagingSenderId: '1005282056769',
    appId: '1:1005282056769:web:afb80096906abc1854c4c0',
    measurementId: 'G-181JSRDL70'
  };

  const STORAGE_KEY = 'chiefOfficerRotation.v1';
  const CONTRACTED_DAYS = 186;
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const state = loadState();
  const now = new Date();
  let viewYear = now.getFullYear();
  let viewMonth = now.getMonth();
  let selectionStart = null;
  let selectionEnd = null;
  let currentUser = null;
  let monthUnsubscribe = null;
  let cloudReady = false;
  let applyingRemoteSnapshot = false;

  const firebaseApp = initializeApp(firebaseConfig);
  const auth = getAuth(firebaseApp);
  let db;
  try {
    db = initializeFirestore(firebaseApp, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
  } catch {
    db = getFirestore(firebaseApp);
  }

  const $ = (id) => document.getElementById(id);
  const calendar = $('calendar');
  const monthsCollection = collection(db, 'rotationPlanner', 'shared', 'months');
  const configRef = doc(db, 'rotationPlanner', 'shared');

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === null) return { days: { ...(window.DEFAULT_ROTATION_DAYS || {}) } };
      const parsed = JSON.parse(saved || '{}');
      return { days: parsed.days && typeof parsed.days === 'object' ? parsed.days : {} };
    } catch {
      return { days: { ...(window.DEFAULT_ROTATION_DAYS || {}) } };
    }
  }

  function saveLocalState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function setSyncStatus(text, kind = '') {
    const el = $('syncStatus');
    el.textContent = text;
    el.className = `sync-status ${kind}`.trim();
  }

  function dateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function dateFromKey(key) {
    const [y,m,d] = key.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }

  function addDays(date, n) {
    const out = new Date(date);
    out.setDate(out.getDate() + n);
    return out;
  }

  function sameDate(a, b) { return a && b && dateKey(a) === dateKey(b); }

  function formatDM(date) {
    return `${String(date.getDate()).padStart(2,'0')}-${MONTHS[date.getMonth()].slice(0,3)}`;
  }

  function durationParts(days) { return { weeks: Math.floor(days / 7), days: days % 7 }; }

  function formatDuration(days) {
    const p = durationParts(days);
    const weekText = p.weeks ? `${p.weeks} ${p.weeks === 1 ? 'week' : 'weeks'}` : '';
    const dayText = p.days ? `${p.days} ${p.days === 1 ? 'day' : 'days'}` : '';
    return [weekText, dayText].filter(Boolean).join(' ') || '0 days';
  }

  function compactDuration(days) {
    const p = durationParts(days);
    return `${p.weeks}W${p.days}`;
  }

  function terminalHLabels() {
    const labels = {};
    for (const r of getRotations()) {
      let d = addDays(r.workEnd, 1);
      while (state.days[dateKey(d)] === 'H') {
        labels[dateKey(d)] = compactDuration(r.days);
        d = addDays(d, 1);
      }
    }
    return labels;
  }

  function render() {
    $('yearLabel').textContent = viewYear;
    $('monthLabel').textContent = MONTHS[viewMonth];
    renderCalendar();
    renderRotations();
    renderSummary();
    updateSelectionMessage();
  }

  function renderCalendar() {
    calendar.innerHTML = '';
    const hLabels = terminalHLabels();
    const first = new Date(viewYear, viewMonth, 1, 12);
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0, 12).getDate();
    const mondayIndex = (first.getDay() + 6) % 7;

    for (let i = 0; i < mondayIndex; i++) {
      const blank = document.createElement('div');
      blank.className = 'day empty';
      calendar.appendChild(blank);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(viewYear, viewMonth, day, 12);
      const key = dateKey(date);
      const code = state.days[key] || '';
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = `day ${code}`.trim();
      cell.dataset.date = key;
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-label', `${day} ${MONTHS[viewMonth]} ${viewYear}${code ? `, ${labelForCode(code)}` : ''}`);
      const hDuration = code === 'H' ? hLabels[key] : '';
      cell.innerHTML = `<span>${day}</span>${code ? `<span class="code">${code}</span>` : ''}${hDuration ? `<span class="h-duration">${hDuration}</span>` : ''}`;
      if (sameDate(date, now)) cell.classList.add('today');
      if (selectionStart && sameDate(date, selectionStart)) cell.classList.add('selected');
      if (selectionStart && selectionEnd && date >= minDate(selectionStart, selectionEnd) && date <= maxDate(selectionStart, selectionEnd)) cell.classList.add('range-preview');
      cell.addEventListener('click', () => handleDayTap(date));
      calendar.appendChild(cell);
    }
  }

  function minDate(a,b) { return a <= b ? a : b; }
  function maxDate(a,b) { return a >= b ? a : b; }

  function handleDayTap(date) {
    if (!currentUser) return;
    if (!selectionStart || selectionEnd) {
      selectionStart = date;
      selectionEnd = null;
    } else {
      selectionEnd = date;
    }
    renderCalendar();
    updateSelectionMessage();
  }

  function updateSelectionMessage() {
    const msg = $('selectionMessage');
    const cancel = $('cancelSelection');
    if (!currentUser) {
      msg.textContent = 'Sign in to edit the shared planner.';
      cancel.classList.add('hidden');
      return;
    }
    if (!selectionStart) {
      msg.textContent = 'Tap a start date, then an end date.';
      cancel.classList.add('hidden');
      return;
    }
    cancel.classList.remove('hidden');
    if (!selectionEnd) {
      msg.textContent = `${formatDM(selectionStart)} selected — tap an end date, or assign this single day.`;
    } else {
      const a = minDate(selectionStart, selectionEnd);
      const b = maxDate(selectionStart, selectionEnd);
      msg.textContent = `${formatDM(a)} → ${formatDM(b)} selected — choose Will, Paul, H or Clear.`;
    }
  }

  function monthDocIdFromKey(key) { return key.slice(0, 7); }
  function dayFieldFromKey(key) { return `d${key.slice(8, 10)}`; }

  async function writeDayChanges(changes) {
    if (!currentUser || !cloudReady) throw new Error('Cloud planner is not ready.');
    const byMonth = new Map();
    for (const [key, code] of Object.entries(changes)) {
      const monthId = monthDocIdFromKey(key);
      if (!byMonth.has(monthId)) byMonth.set(monthId, {});
      byMonth.get(monthId)[dayFieldFromKey(key)] = code || deleteField();
    }
    setSyncStatus('Saving…', 'pending');
    await Promise.all([...byMonth.entries()].map(([monthId, fields]) =>
      setDoc(doc(monthsCollection, monthId), {
        ...fields,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.email || currentUser.uid
      }, { merge: true })
    ));
  }

  async function assignSelection(code) {
    if (!selectionStart || !currentUser) return;
    const start = selectionEnd ? minDate(selectionStart, selectionEnd) : selectionStart;
    const end = selectionEnd ? maxDate(selectionStart, selectionEnd) : selectionStart;
    const changes = {};
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      const key = dateKey(d);
      changes[key] = code;
      if (code) state.days[key] = code;
      else delete state.days[key];
    }
    saveLocalState();
    clearSelection(false);
    render();
    try {
      await writeDayChanges(changes);
    } catch (err) {
      console.error(err);
      setSyncStatus(navigator.onLine ? 'Sync error' : 'Offline — pending', 'error');
      alert('The change is saved on this device but has not yet been confirmed by Firebase. Check your connection and Firestore rules.');
    }
  }

  function clearSelection(doRender = true) {
    selectionStart = null;
    selectionEnd = null;
    if (doRender) render();
  }

  function labelForCode(code) {
    return code === 'W' ? 'Will' : code === 'P' ? 'Paul' : code === 'H' ? 'Handover' : '';
  }

  function getRotations() {
    const keys = Object.keys(state.days).sort();
    if (!keys.length) return [];
    const workKeys = keys.filter(k => state.days[k] === 'W' || state.days[k] === 'P');
    if (!workKeys.length) return [];
    const rotations = [];
    let current = null;
    for (const key of workKeys) {
      const person = state.days[key];
      const date = dateFromKey(key);
      const previousDate = current ? addDays(current.workEnd, 1) : null;
      const continuous = current && person === current.code && dateKey(previousDate) === key;
      if (!continuous) {
        if (current) rotations.push(finalizeRotation(current));
        current = { code: person, workStart: date, workEnd: date, days: 1 };
      } else {
        current.workEnd = date;
        current.days += 1;
      }
    }
    if (current) rotations.push(finalizeRotation(current));
    return rotations;
  }

  function finalizeRotation(rotation) {
    let displayStart = new Date(rotation.workStart);
    let probe = addDays(rotation.workStart, -1);
    if (state.days[dateKey(probe)] === 'H') {
      displayStart = probe;
      while (state.days[dateKey(addDays(displayStart, -1))] === 'H') displayStart = addDays(displayStart, -1);
    }
    let displayEnd = new Date(rotation.workEnd);
    const next = addDays(rotation.workEnd, 1);
    if (state.days[dateKey(next)] === 'H') displayEnd = next;
    return { ...rotation, displayStart, displayEnd };
  }

  function renderRotations() {
    const list = $('rotationList');
    const showAll = $('allYearsToggle').checked;
    const rotations = getRotations().filter(r => showAll || r.workStart.getFullYear() === viewYear);
    list.innerHTML = '';
    if (!rotations.length) {
      list.innerHTML = '<div class="empty-state">No rotations entered for this view.</div>';
      return;
    }
    for (const r of rotations) {
      const row = document.createElement('div');
      row.className = 'rotation-row';
      row.innerHTML = `
        <strong><i class="person-dot ${r.code}"></i>${r.code === 'W' ? 'Will' : 'Paul'}</strong>
        <span>${formatDM(r.displayStart)}</span>
        <span>${formatDM(r.displayEnd)}</span>
        <span class="days" title="${r.days} working days">${formatDuration(r.days)}</span>`;
      list.appendChild(row);
    }
  }

  function contractWindow(person, startYear) {
    if (person === 'W') {
      return {
        start: new Date(startYear, 2, 10, 12), end: new Date(startYear + 1, 2, 9, 12),
        label: `Will ${formatDM(new Date(startYear, 2, 10, 12))} ${startYear} → ${formatDM(new Date(startYear + 1, 2, 9, 12))} ${startYear + 1}`
      };
    }
    return {
      start: new Date(startYear, 4, 22, 12), end: new Date(startYear + 1, 4, 21, 12),
      label: `Paul ${formatDM(new Date(startYear, 4, 22, 12))} ${startYear} → ${formatDM(new Date(startYear + 1, 4, 21, 12))} ${startYear + 1}`
    };
  }

  function contractTotal(person, startYear) {
    const windowInfo = contractWindow(person, startYear);
    let total = 0;
    for (let d = new Date(windowInfo.start); d <= windowInfo.end; d = addDays(d, 1)) {
      const code = state.days[dateKey(d)] || '';
      if (code === person || code === 'H') total += 1;
    }
    const keys = Object.keys(state.days).sort();
    const latest = keys.length ? dateFromKey(keys[keys.length - 1]) : null;
    const completeThroughEnd = latest && latest >= windowInfo.end;
    return { ...windowInfo, total, variance: total - CONTRACTED_DAYS, completeThroughEnd };
  }

  function signedNumber(n) { return n > 0 ? `+${n}` : String(n); }

  function renderSummary() {
    const contractBody = $('contractSummaryBody');
    const contracts = [contractTotal('W', viewYear), contractTotal('P', viewYear)];
    contractBody.innerHTML = contracts.map((c, i) => {
      const varianceClass = c.variance > 0 ? 'over' : c.variance < 0 ? 'under' : 'even';
      const varianceText = c.completeThroughEnd ? signedNumber(c.variance) : `${signedNumber(c.variance)}*`;
      return `<tr>
        <th><strong>${i === 0 ? 'Will' : 'Paul'}</strong><span>${c.label.replace(i === 0 ? 'Will ' : 'Paul ','')}</span></th>
        <td class="variance ${varianceClass}">${varianceText}</td><td>${c.total}</td><td>${CONTRACTED_DAYS}</td>
      </tr>`;
    }).join('');
    const incomplete = contracts.some(c => !c.completeThroughEnd);
    $('contractNote').textContent = incomplete
      ? '* Contract period extends beyond the latest date currently entered, so the over/under figure is provisional. H days count as onboard.'
      : 'H days count as onboard in each person’s contract-year total. All contract figures are shown in days.';
  }

  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function exportBackup() {
    const payload = { app: 'Chief Officer Rotation Planner', version: 6, exportedAt: new Date().toISOString(), days: state.days };
    downloadFile(`rotation-backup-${dateKey(new Date())}.json`, JSON.stringify(payload, null, 2), 'application/json');
  }

  async function replaceCloudPlan(days) {
    if (!currentUser) throw new Error('Not signed in');
    setSyncStatus('Saving…', 'pending');
    const existing = await getDocs(monthsCollection);
    let batch = writeBatch(db);
    let ops = 0;
    const commitIfNeeded = async (force = false) => {
      if (ops >= 430 || (force && ops > 0)) { await batch.commit(); batch = writeBatch(db); ops = 0; }
    };
    for (const snap of existing.docs) {
      batch.delete(snap.ref); ops++; await commitIfNeeded();
    }
    const grouped = {};
    for (const [key, code] of Object.entries(days)) {
      if (!['W','P','H'].includes(code)) continue;
      const monthId = monthDocIdFromKey(key);
      grouped[monthId] ||= {};
      grouped[monthId][dayFieldFromKey(key)] = code;
    }
    for (const [monthId, fields] of Object.entries(grouped)) {
      batch.set(doc(monthsCollection, monthId), { ...fields, updatedAt: serverTimestamp(), updatedBy: currentUser.email || currentUser.uid });
      ops++; await commitIfNeeded();
    }
    await commitIfNeeded(true);
    await setDoc(configRef, { initialized: true, updatedAt: serverTimestamp(), updatedBy: currentUser.email || currentUser.uid }, { merge: true });
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        const days = data.days || data;
        if (!days || typeof days !== 'object') throw new Error('Invalid backup');
        const cleaned = {};
        for (const [key, value] of Object.entries(days)) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(key) && ['W','P','H'].includes(value)) cleaned[key] = value;
        }
        if (!confirm('Replace the shared planner for both Will and Paul with this backup?')) return;
        state.days = cleaned; saveLocalState(); render();
        await replaceCloudPlan(cleaned);
        alert('Shared backup imported.');
      } catch (err) {
        console.error(err);
        alert('That file could not be imported to the shared planner.');
      }
    };
    reader.readAsText(file);
  }

  function exportCsv() {
    const rotations = getRotations();
    const rows = [['Person','Start','Finish','Duration','Working Days']];
    for (const r of rotations) rows.push([r.code === 'W' ? 'Will' : 'Paul', formatDM(r.displayStart), formatDM(r.displayEnd), formatDuration(r.days), r.days]);
    const csv = rows.map(row => row.map(v => `"${String(v).replaceAll('"','""')}"`).join(',')).join('\r\n');
    downloadFile(`rotations-${dateKey(new Date())}.csv`, csv, 'text/csv;charset=utf-8');
  }

  async function loadSpreadsheetPlan() {
    if (!window.DEFAULT_ROTATION_DAYS) return alert('The bundled spreadsheet plan is unavailable.');
    if (!confirm('Replace the shared schedule for BOTH users with the plan imported from the original Excel workbook?')) return;
    state.days = { ...window.DEFAULT_ROTATION_DAYS }; saveLocalState(); clearSelection(false); render();
    try { await replaceCloudPlan(state.days); } catch (err) { console.error(err); alert('Could not replace the cloud planner.'); }
  }

  function monthSnapshotToDays(snapshot) {
    const days = {};
    for (const monthDoc of snapshot.docs) {
      const monthId = monthDoc.id;
      if (!/^\d{4}-\d{2}$/.test(monthId)) continue;
      const data = monthDoc.data();
      for (let d = 1; d <= 31; d++) {
        const field = `d${String(d).padStart(2, '0')}`;
        if (['W','P','H'].includes(data[field])) days[`${monthId}-${String(d).padStart(2, '0')}`] = data[field];
      }
    }
    return days;
  }

  async function initializeSharedPlannerIfNeeded() {
    const configSnap = await getDoc(configRef);
    if (configSnap.exists() && configSnap.data().initialized) return;
    if (!navigator.onLine) {
      setSyncStatus('Offline — cannot initialise', 'error');
      return;
    }
    await replaceCloudPlan(state.days);
  }

  function startRealtimeSync() {
    if (monthUnsubscribe) monthUnsubscribe();
    monthUnsubscribe = onSnapshot(monthsCollection, { includeMetadataChanges: true }, snapshot => {
      applyingRemoteSnapshot = true;
      state.days = monthSnapshotToDays(snapshot);
      saveLocalState();
      applyingRemoteSnapshot = false;
      cloudReady = true;
      render();
      const pending = snapshot.docs.some(d => d.metadata.hasPendingWrites);
      if (!navigator.onLine) setSyncStatus(pending ? 'Offline — changes pending' : 'Offline — cached', 'offline');
      else if (pending) setSyncStatus('Saving…', 'pending');
      else if (snapshot.metadata.fromCache) setSyncStatus('Reconnecting…', 'pending');
      else setSyncStatus('Synced', 'synced');
    }, err => {
      console.error(err);
      cloudReady = false;
      setSyncStatus('Sync blocked — check Firestore rules', 'error');
    });
  }

  function setAuthUi(user) {
    const overlay = $('authPanel');
    const signed = $('signedInBar');
    if (user) {
      overlay.classList.add('hidden');
      signed.classList.remove('hidden');
      $('signedInEmail').textContent = user.email || 'Signed in';
      document.body.classList.remove('locked');
    } else {
      overlay.classList.remove('hidden');
      signed.classList.add('hidden');
      document.body.classList.add('locked');
      setSyncStatus('Signed out', 'offline');
    }
    updateSelectionMessage();
  }

  async function login() {
    const email = $('loginEmail').value.trim();
    const password = $('loginPassword').value;
    $('loginError').textContent = '';
    if (!email || !password) return $('loginError').textContent = 'Enter your email and password.';
    $('loginBtn').disabled = true;
    $('loginBtn').textContent = 'Signing in…';
    try {
      await setPersistence(auth, browserLocalPersistence);
      await signInWithEmailAndPassword(auth, email, password);
      $('loginPassword').value = '';
    } catch (err) {
      console.error(err);
      $('loginError').textContent = 'Sign-in failed. Check the email/password created in Firebase.';
    } finally {
      $('loginBtn').disabled = false;
      $('loginBtn').textContent = 'Sign in';
    }
  }

  document.querySelectorAll('.assign-btn').forEach(btn => btn.addEventListener('click', () => assignSelection(btn.dataset.code)));
  $('cancelSelection').addEventListener('click', () => clearSelection());
  $('prevMonth').addEventListener('click', () => { viewMonth--; if (viewMonth < 0) { viewMonth = 11; viewYear--; } render(); });
  $('nextMonth').addEventListener('click', () => { viewMonth++; if (viewMonth > 11) { viewMonth = 0; viewYear++; } render(); });
  $('prevYear').addEventListener('click', () => { viewYear--; render(); });
  $('nextYear').addEventListener('click', () => { viewYear++; render(); });
  $('todayBtn').addEventListener('click', () => { viewYear = now.getFullYear(); viewMonth = now.getMonth(); clearSelection(false); render(); });
  $('allYearsToggle').addEventListener('change', renderRotations);
  $('exportBackup').addEventListener('click', exportBackup);
  $('exportCsv').addEventListener('click', exportCsv);
  $('loadSpreadsheetPlan').addEventListener('click', loadSpreadsheetPlan);
  $('importBackupBtn').addEventListener('click', () => $('importBackupInput').click());
  $('importBackupInput').addEventListener('change', e => { const file = e.target.files[0]; if (file) importBackup(file); e.target.value = ''; });
  $('clearAll').addEventListener('click', async () => {
    if (!currentUser) return;
    if (!confirm('Delete ALL shared rotation data for both Will and Paul?')) return;
    state.days = {}; saveLocalState(); clearSelection(false); render();
    try { await replaceCloudPlan({}); } catch (err) { console.error(err); alert('Could not clear the cloud planner.'); }
  });

  $('loginBtn').addEventListener('click', login);
  $('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  $('signOutBtn').addEventListener('click', () => signOut(auth));

  const yearDialog = $('yearDialog');
  $('yearBtn').addEventListener('click', () => { $('yearInput').value = viewYear; yearDialog.showModal(); setTimeout(() => $('yearInput').select(), 0); });
  $('goYear').addEventListener('click', (e) => {
    const y = Number($('yearInput').value);
    if (Number.isInteger(y) && y >= 2000 && y <= 2100) { viewYear = y; clearSelection(false); setTimeout(render, 0); }
    else e.preventDefault();
  });

  window.addEventListener('online', () => { if (currentUser) setSyncStatus('Reconnecting…', 'pending'); });
  window.addEventListener('offline', () => { if (currentUser) setSyncStatus('Offline — cached', 'offline'); });

  onAuthStateChanged(auth, async user => {
    currentUser = user;
    cloudReady = false;
    setAuthUi(user);
    if (monthUnsubscribe) { monthUnsubscribe(); monthUnsubscribe = null; }
    if (!user) { render(); return; }
    setSyncStatus('Connecting…', 'pending');
    try {
      await initializeSharedPlannerIfNeeded();
      startRealtimeSync();
    } catch (err) {
      console.error(err);
      setSyncStatus('Sync blocked — check Firestore rules', 'error');
    }
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
  }

  render();
})();
