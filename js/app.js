// =============================================================
//  おかね帳 — 画面と操作
// =============================================================
import * as L from './logic.js';
import * as DB from './db.js';

const APP_VERSION = '1.0.0';
const { T } = L;

// ---------------------------------------------------------------- 状態
const S = {
  accounts: [], categories: [], txs: [],
  meta: { lastAccount: {}, lastBackup: null },
  tab: 'home',
  draft: null,
  hist: { q: '', period: 'all', start: '', end: '', type: '', categoryId: '', accountId: '', limit: 150, open: false },
  sum: { mode: 'month', anchor: L.today(), cStart: L.addDays(L.today(), -29), cEnd: L.today(), gran: 'day', categoryId: '', accountId: '' },
  catTab: 'expense',
};

// ---------------------------------------------------------------- 小道具
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const yen = L.fmtYen;
const acc = (id) => S.accounts.find((a) => a.id === id);
const cat = (id) => S.categories.find((c) => c.id === id);
const catName = (id) => cat(id)?.name || '';
const activeAccounts = () => S.accounts.filter((a) => !a.archived).sort((a, b) => a.order - b.order);
const catsOf = (kind, all = false) => S.categories.filter((c) => c.kind === kind && (all || !c.archived)).sort((a, b) => a.order - b.order);
const balances = () => L.accountBalances(S.accounts, S.txs);

const ICON = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15v3M12 10v8M17 6v12"/>',
  wallet: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M21 9h-6a3 3 0 0 0 0 6h6z"/>',
  bank: '<path d="M3 21h18M4 10h16M5 10v8M9.5 10v8M14.5 10v8M19 10v8M12 3l9 5H3z"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/>',
  swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  chevL: '<path d="m15 18-6-6 6-6"/>', chevR: '<path d="m9 18 6-6-6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  clip: '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  filter: '<path d="M3 5h18M6 12h12M10 19h4"/>',
  up: '<path d="m18 15-6-6-6 6"/>', dn: '<path d="m6 9 6 6 6-6"/>',
  scale: '<path d="M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>',
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;
const accIcon = (a) => icon(a?.type === 'bank' ? 'bank' : a?.type === 'cash' ? 'cash' : 'card');
const TYPE_ACC = { bank: '銀行・通帳', cash: '現金・財布', other: 'その他（電子マネー等）' };

// ---------------------------------------------------------------- 読み込み
async function load() {
  const [accounts, categories, txs, meta] = await Promise.all(['accounts', 'categories', 'txs', 'meta'].map(DB.getAll));
  S.accounts = accounts; S.categories = categories; S.txs = txs;
  for (const m of meta) S.meta[m.key] = m.value;
  S.meta.lastAccount ||= {};
  if (!S.categories.length) {
    const ops = [];
    for (const kind of ['expense', 'income']) {
      L.DEFAULT_CATEGORIES[kind].forEach((name, i) => {
        const c = { id: uid(), kind, name, order: i, archived: false };
        S.categories.push(c); ops.push({ store: 'categories', value: c });
      });
    }
    await DB.write(ops);
  }
}
async function setMeta(key, value) { S.meta[key] = value; await DB.setMeta(key, value); }

async function requestPersist() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* 対応していない環境 */ }
}

// ---------------------------------------------------------------- 共通UI
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  el.classList.add('show');
  if (action) el.querySelector('button').onclick = () => { el.classList.remove('show'); action.run(); };
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), action ? 6000 : 2600);
}

function ask({ title, message = '', ok = 'OK', cancel = 'キャンセル', danger = false }) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'dialog-back';
    root.innerHTML = `<div class="dialog" role="alertdialog">
      <h3>${esc(title)}</h3>${message ? `<p>${message}</p>` : ''}
      <div class="dialog-btns">${cancel ? `<button class="btn ghost" data-r="0">${esc(cancel)}</button>` : ''}
      <button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div></div>`;
    document.body.appendChild(root);
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      root.remove(); resolve(b.dataset.r === '1');
    });
  });
}

function openSheet(title, bodyHTML, onMount) {
  const root = document.createElement('div');
  root.className = 'sheet-back';
  root.innerHTML = `<div class="sheet" role="dialog" aria-label="${esc(title)}">
    <div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="閉じる">${icon('x')}</button></div>
    <div class="sheet-body">${bodyHTML}</div></div>`;
  document.body.appendChild(root);
  document.body.classList.add('noscroll');
  requestAnimationFrame(() => root.classList.add('open'));
  const close = () => {
    root.classList.remove('open');
    setTimeout(() => { root.remove(); if (!$('.sheet-back')) document.body.classList.remove('noscroll'); }, 220);
  };
  root.addEventListener('click', (e) => { if (e.target === root || e.target.closest('[data-close]')) close(); });
  const body = root.querySelector('.sheet-body');
  onMount && onMount(body, close);
  return { body, close };
}

// 画像（IndexedDBの ArrayBuffer → 表示用URL）
const imgURLs = new Map();
async function imageURL(id) {
  if (imgURLs.has(id)) return imgURLs.get(id);
  const r = await DB.get('images', id);
  if (!r) return null;
  const url = URL.createObjectURL(new Blob([r.buf], { type: r.type || 'image/jpeg' }));
  imgURLs.set(id, url);
  return url;
}
function showImage(url) {
  openSheet('レシート画像', `<div class="img-full"><img src="${url}" alt="レシート画像"></div>`);
}

async function saveFile(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}
const stamp = () => { const d = new Date(); return L.ymd(d).replace(/-/g, '') + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0'); };

// ---------------------------------------------------------------- 画面切替
const TABS = [
  ['home', 'ホーム', 'home'], ['input', '入力', 'plus'], ['history', '履歴', 'list'],
  ['summary', '集計', 'chart'], ['accounts', '通帳・現金', 'wallet'],
];
function renderTabs() {
  $('#tabs').innerHTML = TABS.map(([id, label, ic]) =>
    `<a href="#${id}" class="tab ${id === 'input' ? 'tab-main' : ''} ${S.tab === id ? 'active' : ''}" aria-label="${label}">
      <span class="tab-ic">${icon(ic)}</span><span class="tab-label">${label}</span></a>`).join('');
}
function go(tab) {
  if (location.hash !== '#' + tab) location.hash = tab; else route();
}
function route() {
  const t = location.hash.slice(1) || 'home';
  S.tab = TABS.some((x) => x[0] === t) ? t : 'home';
  renderTabs();
  render();
  window.scrollTo(0, 0);
}
function render() {
  const v = $('#view');
  const fn = { home: viewHome, input: viewInput, history: viewHistory, summary: viewSummary, accounts: viewAccounts }[S.tab];
  fn(v);
}
function setTitle(t, right = '') { $('#title').textContent = t; $('#topRight').innerHTML = right; }

// =============================================================
//  ホーム
// =============================================================
function viewHome(v) {
  setTitle('ホーム');
  const accs = activeAccounts();
  if (!accs.length) {
    v.innerHTML = `<section class="card hero-empty">
      <div class="hero-ic">${icon('wallet')}</div>
      <h2>はじめましょう</h2>
      <p>まず、通帳や財布など「お金の保管先」と、今の残高を登録します。</p>
      <button class="btn primary big" data-go="accounts-add">保管先を登録する</button></section>`;
    v.querySelector('[data-go]').onclick = () => { go('accounts'); setTimeout(() => editAccount(null), 50); };
    return;
  }
  const bal = balances();
  const total = L.totalBalance(S.accounts, S.txs);
  const m = L.periodRange('month', L.today());
  const sm = L.summarize(S.txs, m);
  const recent = L.sortTxs(S.txs).slice(0, 5);
  const days = S.meta.lastBackup ? L.daysBetween(S.meta.lastBackup.slice(0, 10), L.today()) : null;
  const needBackup = S.txs.length > 0 && (days === null || days >= 14);

  v.innerHTML = `
  <section class="card total">
    <div class="muted small">合計残高（${L.fmtDate(L.today())}時点）</div>
    <div class="total-amt num">${yen(total)}</div>
    <div class="acc-list">
      ${accs.map((a) => `<button class="acc-row" data-acc="${a.id}">
        <span class="acc-ic ${a.type}">${accIcon(a)}</span><span class="acc-name">${esc(a.name)}</span>
        <span class="num acc-bal ${bal.get(a.id) < 0 ? 'neg' : ''}">${yen(bal.get(a.id))}</span></button>`).join('')}
    </div>
  </section>

  <section class="quick">
    <button data-q="expense"><span class="q-ic exp">${icon('down')}</span>支出</button>
    <button data-q="income"><span class="q-ic inc">${icon('plus')}</span>収入</button>
    <button data-q="transfer"><span class="q-ic tra">${icon('swap')}</span>振替</button>
    <button data-q="receipt"><span class="q-ic rec">${icon('camera')}</span>レシート</button>
  </section>

  ${needBackup ? `<button class="card notice" data-go="accounts">
    <b>バックアップをおすすめします</b><br><span class="small">${days === null ? 'まだ一度もバックアップしていません。' : `最後のバックアップから${days}日経っています。`}「通帳・現金」画面の下から書き出せます。</span></button>` : ''}

  <section class="card">
    <div class="card-head"><h3>${m.label}の収支</h3><button class="link" data-go="summary">集計を見る</button></div>
    <div class="trio">
      <div><div class="muted small">収入</div><div class="num inc-c">${yen(sm.income)}</div></div>
      <div><div class="muted small">支出</div><div class="num exp-c">${yen(sm.expense)}</div></div>
      <div><div class="muted small">収支</div><div class="num ${sm.net < 0 ? 'exp-c' : ''}">${yen(sm.net, true)}</div></div>
    </div>
  </section>

  <section class="card flush">
    <div class="card-head pad"><h3>最近の取引</h3><button class="link" data-go="history">すべて見る</button></div>
    ${recent.length ? `<div class="tx-list">${recent.map(txRow).join('')}</div>` : '<p class="empty">まだ取引がありません</p>'}
  </section>`;

  v.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go)));
  v.querySelectorAll('[data-acc]').forEach((b) => (b.onclick = () => {
    Object.assign(S.hist, { accountId: b.dataset.acc, categoryId: '', type: '', period: 'all', q: '', open: true });
    go('history');
  }));
  v.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => {
    const q = b.dataset.q;
    if (q === 'receipt') { S.draft = newDraft('expense'); go('input'); setTimeout(() => $('#receiptFile')?.click(), 60); return; }
    S.draft = newDraft(q); go('input');
  }));
  bindTxRows(v);
}

// 取引1行
function txRow(t) {
  const a = acc(t.accountId);
  let title, sub, amt, cls;
  if (t.type === T.TRANSFER) {
    title = '振替'; sub = `${a?.name || '?'} → ${acc(t.toAccountId)?.name || '?'}`; amt = yen(t.amount); cls = 'tra-c';
  } else if (t.type === T.ADJUST) {
    title = '残高調整'; sub = `${a?.name || '?'}・${t.memo || ''}`; amt = yen(t.amount, true); cls = 'adj-c';
  } else {
    title = t.payee || catName(t.categoryId) || '（カテゴリなし）';
    sub = `${t.payee ? catName(t.categoryId) + '・' : ''}${a?.name || '?'}${t.memo ? '・' + t.memo : ''}`;
    amt = (t.type === T.INCOME ? '+' : '−') + t.amount.toLocaleString('ja-JP') + '円';
    cls = t.type === T.INCOME ? 'inc-c' : 'exp-c';
  }
  const tag = t.type === T.TRANSFER ? '<span class="tag tra">振替</span>' : t.type === T.ADJUST ? '<span class="tag adj">調整</span>' : '';
  return `<button class="tx-row" data-tx="${t.id}">
    <span class="tx-main"><span class="tx-title">${tag}${esc(title)}${t.imageId ? ` <span class="clip">${icon('clip')}</span>` : ''}</span>
    <span class="tx-sub">${esc(sub)}</span></span>
    <span class="tx-amt num ${cls}">${amt}</span></button>`;
}
function bindTxRows(root) {
  root.querySelectorAll('[data-tx]').forEach((b) => (b.onclick = () => editTx(b.dataset.tx)));
}

// =============================================================
//  入力フォーム（新規・編集で共通）
// =============================================================
function newDraft(type = 'expense') {
  const last = S.meta.lastAccount || {};
  const ok = (id) => (id && acc(id) && !acc(id).archived ? id : null);
  const fallback = activeAccounts()[0]?.id || null;
  return {
    type, date: L.today(), amount: null,
    accountId: ok(last[type]) || (type === 'transfer' ? ok(last.expense) : null) || fallback,
    toAccountId: type === 'transfer' ? ok(last.transferTo) : null,
    categoryId: null, payee: '', memo: '', fee: null, items: [],
    image: null, receipt: null, rstat: {}, touched: {},
  };
}
function draftFromTx(t) {
  return {
    id: t.id, type: t.type, date: t.date, amount: t.type === T.ADJUST ? Math.abs(t.amount) : t.amount,
    sign: t.type === T.ADJUST ? Math.sign(t.amount) || 1 : 1,
    accountId: t.accountId, toAccountId: t.toAccountId || null, categoryId: t.categoryId || null,
    payee: t.payee || '', memo: t.memo || '', items: t.items || [], fee: null,
    image: t.imageId ? { id: t.imageId, stored: true } : null, receiptHash: t.receiptHash || '',
    createdAt: t.createdAt, receipt: null, rstat: {}, touched: {},
  };
}

function badge(st) {
  if (st === 'ok') return '<span class="badge ok">読み取り</span>';
  if (st === 'check') return '<span class="badge warn">要確認</span>';
  if (st === 'none') return '<span class="badge none">未読取</span>';
  return '';
}

function sortedBy(list, counts) {
  return [...list].sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0) || a.order - b.order);
}

function payeeList() {
  const seen = new Set(), out = [];
  for (const t of L.sortTxs(S.txs)) {
    if (t.payee && !seen.has(t.payee)) { seen.add(t.payee); out.push(t.payee); if (out.length >= 80) break; }
  }
  return out;
}

function formHTML(d, mode) {
  const accUse = L.usageCounts(S.txs, 'account');
  const accs = sortedBy(activeAccounts(), accUse);
  // 編集時：アーカイブ済みの保管先も表示
  for (const id of [d.accountId, d.toAccountId]) if (id && acc(id)?.archived && !accs.find((a) => a.id === id)) accs.push(acc(id));
  const accChips = (field, exclude) => accs.filter((a) => a.id !== exclude).map((a) =>
    `<button type="button" class="chip ${d[field] === a.id ? 'on' : ''}" data-set="${field}" data-v="${a.id}">${accIcon(a)}${esc(a.name)}</button>`).join('');
  const isTr = d.type === T.TRANSFER, isAdj = d.type === T.ADJUST;
  const amtStr = d.amount ? d.amount.toLocaleString('ja-JP') : '';
  const r = d.rstat || {};

  let h = '';
  if (mode === 'new') {
    h += `<div class="seg" role="tablist">
      ${['expense', 'income', 'transfer'].map((t) => `<button type="button" class="seg-b ${d.type === t ? 'on ' + t : ''}" data-type="${t}">${L.TYPE_LABEL[t]}</button>`).join('')}
    </div>`;
    if (d.type === T.EXPENSE) {
      h += `<label class="btn receipt-btn">${icon('camera')}<span>レシートを読み取る<small>撮影 または 写真から</small></span>
        <input type="file" id="receiptFile" accept="image/*" hidden></label>`;
    }
  } else {
    h += `<div class="edit-type ${d.type}">${L.TYPE_LABEL[d.type]}</div>`;
  }
  if (d.receipt) h += receiptPanel(d);

  // 金額
  if (isAdj) {
    h += `<div class="field"><div class="lbl">調整の向き</div><div class="seg small">
      <button type="button" class="seg-b ${d.sign > 0 ? 'on income' : ''}" data-sign="1">増やす（+）</button>
      <button type="button" class="seg-b ${d.sign < 0 ? 'on expense' : ''}" data-sign="-1">減らす（−）</button></div></div>`;
  }
  h += `<div class="field amount-field ${d.type}">
      <div class="lbl">${isAdj ? '調整額' : '金額'} ${badge(r.amount)}</div>
      <div class="amount-box"><input id="f-amount" inputmode="numeric" pattern="[0-9,]*" autocomplete="off" placeholder="0" value="${amtStr}"><span>円</span></div>
      ${d.receipt?.result?.total?.note ? `<div class="note warn">${esc(d.receipt.result.total.note)}</div>` : ''}
    </div>`;

  // 日付
  const t0 = L.today(), y0 = L.addDays(t0, -1);
  h += `<div class="field"><div class="lbl">日付 ${badge(r.date)}</div>
    <div class="row"><input type="date" id="f-date" value="${esc(d.date)}" max="${L.addDays(t0, 366)}">
      <button type="button" class="chip ${d.date === t0 ? 'on' : ''}" data-date="${t0}">今日</button>
      <button type="button" class="chip ${d.date === y0 ? 'on' : ''}" data-date="${y0}">昨日</button></div></div>`;

  // 保管先
  if (isTr) {
    h += `<div class="field"><div class="lbl">出金元（減る方）</div><div class="chips">${accChips('accountId')}</div></div>
      <div class="arrow-down">${icon('down')}</div>
      <div class="field"><div class="lbl">入金先（増える方）</div><div class="chips">${accChips('toAccountId', d.accountId)}</div></div>`;
  } else if (isAdj) {
    h += `<div class="field"><div class="lbl">保管先</div><div class="static">${accIcon(acc(d.accountId))} ${esc(acc(d.accountId)?.name || '')}</div></div>`;
  } else {
    const need = d.receipt && !d.accountId;
    h += `<div class="field ${need ? 'need' : ''}"><div class="lbl">${d.type === T.INCOME ? '入金先' : '支払い元'} ${need ? '<span class="badge warn">選んでください</span>' : ''}</div>
      <div class="chips">${accChips('accountId')}</div></div>`;
  }

  // カテゴリ
  if (!isTr && !isAdj) {
    const cats = sortedBy(catsOf(d.type), L.usageCounts(S.txs.filter((t) => t.type === d.type), 'category'));
    if (d.categoryId && !cats.find((c) => c.id === d.categoryId) && cat(d.categoryId)) cats.push(cat(d.categoryId));
    h += `<div class="field"><div class="lbl">カテゴリ ${badge(r.category)}</div>
      <div class="chips grid">${cats.map((c) => `<button type="button" class="chip ${d.categoryId === c.id ? 'on' : ''}" data-set="categoryId" data-v="${c.id}">${esc(c.name)}</button>`).join('')}</div></div>`;
    h += `<div class="field"><div class="lbl">${d.type === T.INCOME ? '相手先' : '店名・相手先'}（任意） ${badge(r.payee)}</div>
      <input id="f-payee" list="payees" autocomplete="off" value="${esc(d.payee)}" placeholder="例）○○スーパー">
      <datalist id="payees">${payeeList().map((p) => `<option value="${esc(p)}">`).join('')}</datalist></div>`;
  }

  // 手数料（振替の新規のみ）
  if (isTr && mode === 'new') {
    h += `<div class="field"><div class="lbl">手数料（任意・別の支出として登録）</div>
      <div class="amount-box small"><input id="f-fee" inputmode="numeric" pattern="[0-9,]*" placeholder="0" value="${d.fee ? d.fee.toLocaleString('ja-JP') : ''}"><span>円</span></div>
      <div class="note">出金元から「手数料」カテゴリの支出として記録します</div></div>`;
  }

  h += `<div class="field"><div class="lbl">${isAdj ? '理由（必須）' : 'メモ（任意）'}</div>
    <input id="f-memo" autocomplete="off" value="${esc(d.memo)}" placeholder="${isAdj ? '例）財布の現金を数え直した' : ''}"></div>`;

  // 画像
  if (d.type === T.EXPENSE) {
    if (d.image) {
      h += `<div class="field"><div class="lbl">添付画像</div><div class="attach">
        <button type="button" class="thumb" data-act="view-img"><img id="f-thumb" alt=""></button>
        <button type="button" class="btn ghost small" data-act="rm-img">画像を外す</button></div></div>`;
    } else if (!d.receipt) {
      h += `<label class="btn ghost small attach-btn">${icon('clip')}<span>画像を添付</span><input type="file" id="attachFile" accept="image/*" hidden></label>`;
    }
  }

  h += `<div class="err" id="f-err"></div>
    <div class="save-bar">
      ${mode === 'edit' ? '<button type="button" class="btn danger-ghost" data-act="delete">削除</button>' : ''}
      <button type="button" class="btn primary big grow" data-act="save">${mode === 'edit' ? '変更を保存' : '登録する'}</button>
    </div>`;
  return h;
}

function receiptPanel(d) {
  const R = d.receipt;
  let h = `<div class="receipt-card">`;
  if (R.state === 'loading') {
    h += `<div class="rc-status"><div class="spinner"></div><div><b>読み取り中…</b><div class="small muted" id="ocr-msg">${esc(R.msg || '準備しています')}</div>
      <div class="bar"><i id="ocr-bar" style="width:${Math.round((R.progress || 0) * 100)}%"></i></div></div></div>
      <p class="small muted">初回は読み取り用データ（約10MB）の読み込みがあります。その間に下の項目を入力しても大丈夫です。</p>`;
  } else if (R.state === 'error') {
    h += `<div class="rc-status"><div><b>読み取れませんでした</b><div class="small">${esc(R.msg || '')}</div>
      <div class="small muted">画像は添付されています。金額などを手で入力して登録できます。</div></div></div>`;
  } else if (R.state === 'done') {
    const p = R.result;
    const nothing = !p.total.value && !p.date.value && !p.store.value;
    h += `<div class="rc-status"><div><b>${nothing ? '文字をほとんど読み取れませんでした' : '読み取りました。内容を確認してください'}</b>
      <div class="small muted">黄色の「要確認」は推測を含む項目です。違っていたら直してください。</div></div></div>`;
    const info = [p.subtotal != null && `小計 ${yen(p.subtotal)}`, p.tax != null && `税 ${yen(p.tax)}`,
      p.paid != null && `預り ${yen(p.paid)}`, p.change != null && `お釣り ${yen(p.change)}`].filter(Boolean);
    if (info.length) h += `<div class="small muted rc-info">${info.join('　')}<br>※ 税・預り・お釣りは支払額に含めていません</div>`;
    const cands = p.amounts.filter((a) => a.value > 0).slice(0, 10);
    if (cands.length) {
      h += `<div class="small lbl2">金額の候補（タップで金額に入れる）</div><div class="chips">
        ${cands.map((a) => `<button type="button" class="chip small ${d.amount === a.value ? 'on' : ''}" data-amt="${a.value}">${a.label ? `<b>${esc(a.label)}</b> ` : ''}${yen(a.value)}</button>`).join('')}</div>`;
    }
    if (p.items.length) {
      const sum = p.items.reduce((s, i) => s + i.amount, 0);
      h += `<details class="rc-items"><summary>明細 ${p.items.length}件（計 ${yen(sum)}）${badge(p.itemsStatus)}</summary>
        <table>${p.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${yen(i.amount)}</td></tr>`).join('')}</table>
        <label class="check"><input type="checkbox" id="f-items-memo" ${d.itemsToMemo ? 'checked' : ''}> 明細をメモにも書き込む</label></details>`;
    }
    h += `<details class="rc-raw"><summary>読み取った文字をそのまま見る</summary><pre>${esc(p.text)}</pre></details>`;
  }
  if (d.image) h += `<label class="check"><input type="checkbox" id="f-keep-img" ${d.keepImage !== false ? 'checked' : ''}> レシート画像を取引に保存する</label>`;
  h += `<button type="button" class="link small" data-act="cancel-receipt">読み取りをやめて手入力に戻す</button></div>`;
  return h;
}

/** フォームを el に組み込む。onDone は保存・削除後に呼ばれる */
function mountForm(el, d, mode, onDone) {
  const rerender = () => {
    const y = el.closest('.sheet-body')?.scrollTop;
    el.innerHTML = formHTML(d, mode);
    bind();
    if (y != null) el.closest('.sheet-body').scrollTop = y;
  };
  const err = (m) => { const e = $('#f-err', el); e.textContent = m || ''; if (m) e.scrollIntoView({ block: 'center', behavior: 'smooth' }); };

  async function bind() {
    // 金額欄：数字だけ・3桁区切り
    const fmtInput = (inp, key) => inp && inp.addEventListener('input', () => {
      const digits = inp.value.normalize('NFKC').replace(/[^\d]/g, '').replace(/^0+(?=\d)/, '').slice(0, 11);
      d[key] = digits ? parseInt(digits, 10) : null;
      inp.value = digits ? d[key].toLocaleString('ja-JP') : '';
      if (key === 'amount') { d.touched.amount = true; d.rstat.amount = ''; }
    });
    fmtInput($('#f-amount', el), 'amount');
    fmtInput($('#f-fee', el), 'fee');
    $('#f-date', el)?.addEventListener('change', (e) => { d.date = e.target.value; d.touched.date = true; d.rstat.date = ''; rerender(); });
    $('#f-memo', el)?.addEventListener('input', (e) => (d.memo = e.target.value));
    const payee = $('#f-payee', el);
    if (payee) {
      payee.addEventListener('input', (e) => { d.payee = e.target.value; d.touched.payee = true; d.rstat.payee = ''; });
      payee.addEventListener('change', () => {
        // 以前と同じ店名なら、そのとき使ったカテゴリを提案
        if (d.touched.category || !d.payee) return;
        const prev = L.sortTxs(S.txs).find((t) => t.type === d.type && t.payee === d.payee && t.categoryId && cat(t.categoryId) && !cat(t.categoryId).archived);
        if (prev) { d.categoryId = prev.categoryId; rerender(); }
      });
    }
    $('#f-items-memo', el)?.addEventListener('change', (e) => (d.itemsToMemo = e.target.checked));
    $('#f-keep-img', el)?.addEventListener('change', (e) => (d.keepImage = e.target.checked));
    $('#receiptFile', el)?.addEventListener('change', (e) => { const f = e.target.files[0]; if (f) startReceipt(d, f, rerender); });
    $('#attachFile', el)?.addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const { loadImage, compressImage, hashFile } = await import('./ocr.js');
        const img = await loadImage(f);
        d.image = { ...(await compressImage(img)), url: URL.createObjectURL(f) };
        d.receiptHash = d.receiptHash || (await hashFile(f));
        rerender();
      } catch { toast('画像を読み込めませんでした'); }
    });
    const thumb = $('#f-thumb', el);
    if (thumb && d.image) {
      thumb.src = d.image.url || (d.image.id ? (await imageURL(d.image.id)) || '' : '');
      if (!thumb.src || thumb.src === location.href) thumb.closest('.attach').insertAdjacentHTML('beforeend', '<span class="small muted">画像データがありません（バックアップに含まれていなかった可能性）</span>');
    }
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !el.contains(b)) return;
    if (b.dataset.type) {
      const keep = { date: d.date, amount: d.amount, memo: d.memo };
      Object.assign(d, newDraft(b.dataset.type), keep);
      rerender(); return;
    }
    if (b.dataset.set) {
      d[b.dataset.set] = b.dataset.v;
      if (b.dataset.set === 'categoryId') { d.touched.category = true; d.rstat.category = ''; }
      if (b.dataset.set === 'accountId' && d.toAccountId === d.accountId) d.toAccountId = null;
      rerender(); return;
    }
    if (b.dataset.date) { d.date = b.dataset.date; d.touched.date = true; d.rstat.date = ''; rerender(); return; }
    if (b.dataset.sign) { d.sign = +b.dataset.sign; rerender(); return; }
    if (b.dataset.amt) { d.amount = +b.dataset.amt; d.touched.amount = true; d.rstat.amount = ''; rerender(); return; }
    const act = b.dataset.act;
    if (act === 'view-img') {
      const url = d.image?.url || (d.image?.id && (await imageURL(d.image.id)));
      if (url) showImage(url);
    }
    if (act === 'rm-img') { d.image = null; d.receiptHash = ''; rerender(); }
    if (act === 'cancel-receipt') { if (d.receipt) d.receipt.cancelled = true; d.receipt = null; d.rstat = {}; d.image = null; d.receiptHash = ''; rerender(); }
    if (act === 'save') {
      const m = await saveDraft(d, mode);
      if (m === true) onDone && onDone('saved'); else if (m) err(m);
    }
    if (act === 'delete') {
      if (await deleteTx(d.id)) onDone && onDone('deleted');
    }
  });
  rerender();
  return rerender;
}

// ---------------------------------------------------------------- レシート読み取り
async function startReceipt(d, file, rerender) {
  const token = {};
  d.receipt = { state: 'loading', msg: '画像を準備しています', progress: 0, token };
  d.rstat = {};
  d.accountId = null;            // 支払い元は自分で選ぶ
  rerender();
  let ocr;
  try {
    ocr = await import('./ocr.js');
    const img = await ocr.loadImage(file);
    d.image = { ...(await ocr.compressImage(img)), url: URL.createObjectURL(file) };
    d.keepImage = true;
    d.receiptHash = await ocr.hashFile(file);
    if (d.receipt?.token !== token) return;
    rerender();
    const MSG = {
      'loading tesseract core': '読み取りエンジンを読み込み中', 'initializing tesseract': '読み取りエンジンを準備中',
      'loading language traineddata': '日本語データを読み込み中', 'initializing api': '準備中', 'recognizing text': '文字を読み取り中',
    };
    const text = await ocr.recognizeReceipt(img, (m) => {
      if (d.receipt?.token !== token) return;
      d.receipt.msg = MSG[m.status] || m.status; d.receipt.progress = m.progress || 0;
      const msg = $('#ocr-msg'), bar = $('#ocr-bar');
      if (msg) msg.textContent = d.receipt.msg;
      if (bar) bar.style.width = Math.round(d.receipt.progress * 100) + '%';
    });
    if (d.receipt?.token !== token) return;
    const p = L.parseReceipt(text, L.today());
    d.receipt = { state: 'done', result: p, token };
    // 自分で触った項目は上書きしない
    if (!d.touched.amount) { d.amount = p.total.value || null; d.rstat.amount = p.total.status; }
    if (!d.touched.date) { d.date = p.date.value || ''; d.rstat.date = p.date.status; }
    if (!d.touched.payee) { d.payee = p.store.value || ''; d.rstat.payee = p.store.status; }
    if (!d.touched.category) {
      const c = p.category.value && catsOf('expense').find((x) => x.name === p.category.value);
      d.categoryId = c ? c.id : null; d.rstat.category = c ? 'check' : 'none';
    }
    d.items = p.items;
    rerender();
  } catch (e) {
    if (d.receipt?.token !== token) return;
    d.receipt = { state: 'error', msg: navigator.onLine === false ? 'オフラインのため、読み取り用データを読み込めませんでした（一度オンラインで使うと、以後はオフラインでも使えます）' : (e?.message || String(e)), token };
    rerender();
  }
}

// ---------------------------------------------------------------- 保存・削除
async function saveDraft(d, mode) {
  const now = Date.now();
  const tx = {
    id: d.id || uid(), type: d.type, date: d.date,
    amount: d.type === T.ADJUST ? (d.amount || 0) * (d.sign || 1) : d.amount,
    accountId: d.accountId,
    toAccountId: d.type === T.TRANSFER ? d.toAccountId : null,
    categoryId: d.type === T.EXPENSE || d.type === T.INCOME ? d.categoryId : null,
    payee: d.type === T.TRANSFER || d.type === T.ADJUST ? '' : (d.payee || '').trim(),
    memo: (d.memo || '').trim(),
    items: d.type === T.EXPENSE ? d.items || [] : [],
    receiptHash: d.receiptHash || '',
    imageId: null,
    createdAt: d.createdAt || now, updatedAt: now,
  };
  if (d.itemsToMemo && tx.items.length) {
    const s = tx.items.map((i) => `${i.name} ${i.amount}円`).join('、');
    if (!tx.memo.includes(s)) tx.memo = tx.memo ? `${tx.memo}／${s}` : s;
  }
  const v = L.validateTx(tx, S.accounts);
  if (v) return v;
  if (d.type === T.TRANSFER && d.fee) {
    if (!catsOf('expense', true).find((c) => c.name === '手数料')) {
      const c = { id: uid(), kind: 'expense', name: '手数料', order: catsOf('expense', true).length, archived: false };
      await DB.put('categories', c); S.categories.push(c);
    }
  }

  // 二重登録の確認（レシート・画像付きの支出）
  if (tx.type === T.EXPENSE && (d.receipt || d.receiptHash)) {
    const dup = L.findDuplicates(S.txs, tx, tx.id);
    if (dup.length) {
      const t = dup[0];
      const same = tx.receiptHash && t.receiptHash === tx.receiptHash;
      const okGo = await ask({
        title: '同じレシートかもしれません',
        message: `${same ? '同じ画像のレシートがすでに登録されています。' : '同じ日付・金額の支出がすでにあります。'}<br><br>
          <b>${esc(L.fmtDate(t.date))}　${esc(t.payee || catName(t.categoryId))}　${yen(t.amount)}</b><br><br>それでも登録しますか？`,
        ok: '登録する', cancel: 'やめる',
      });
      if (!okGo) return null;
    }
  }

  const ops = [];
  // 画像
  const old = S.txs.find((x) => x.id === tx.id);
  const keep = d.image && (d.receipt ? d.keepImage !== false : true);
  if (keep && d.image.stored) tx.imageId = d.image.id;
  else if (keep && d.image.buf) {
    tx.imageId = uid();
    ops.push({ store: 'images', value: { id: tx.imageId, buf: d.image.buf, type: d.image.type } });
  }
  if (old?.imageId && old.imageId !== tx.imageId) ops.push({ store: 'images', del: old.imageId });
  ops.push({ store: 'txs', value: tx });

  let feeTx = null;
  if (d.type === T.TRANSFER && d.fee && mode === 'new') {
    feeTx = { id: uid(), type: T.EXPENSE, date: tx.date, amount: d.fee, accountId: tx.accountId, toAccountId: null,
      categoryId: catsOf('expense', true).find((c) => c.name === '手数料').id, payee: '振替手数料', memo: '',
      items: [], receiptHash: '', imageId: null, createdAt: now + 1, updatedAt: now + 1 };
    ops.push({ store: 'txs', value: feeTx });
  }
  try { await DB.write(ops); } catch (e) { return '保存できませんでした：' + (e?.message || e); }

  S.txs = S.txs.filter((x) => x.id !== tx.id).concat(tx, feeTx ? [feeTx] : []);
  if (old?.imageId && old.imageId !== tx.imageId) imgURLs.delete(old.imageId);
  if (mode === 'new' && tx.type !== T.ADJUST) {
    const la = { ...S.meta.lastAccount, [tx.type]: tx.accountId };
    if (tx.type === T.TRANSFER) la.transferTo = tx.toAccountId;
    setMeta('lastAccount', la);
  }
  requestPersist();
  toast(mode === 'new' ? `${L.TYPE_LABEL[tx.type]} ${yen(Math.abs(tx.amount))} を登録しました${feeTx ? '（手数料も登録）' : ''}` : '変更を保存しました');
  return true;
}

async function deleteTx(id) {
  const t = S.txs.find((x) => x.id === id);
  if (!t) return false;
  const ok = await ask({ title: 'この取引を削除しますか？', message: `${esc(L.fmtDate(t.date))}　${yen(Math.abs(t.amount))}`, ok: '削除', danger: true });
  if (!ok) return false;
  const img = t.imageId ? await DB.get('images', t.imageId) : null;
  await DB.write([{ store: 'txs', del: id }, ...(t.imageId ? [{ store: 'images', del: t.imageId }] : [])]);
  S.txs = S.txs.filter((x) => x.id !== id);
  toast('削除しました', {
    label: '元に戻す',
    run: async () => {
      await DB.write([{ store: 'txs', value: t }, ...(img ? [{ store: 'images', value: img }] : [])]);
      S.txs.push(t); render();
    },
  });
  return true;
}

function editTx(id) {
  const t = S.txs.find((x) => x.id === id);
  if (!t) return;
  const d = draftFromTx(t);
  openSheet('取引の編集', '<form class="tx-form" onsubmit="return false"></form>', (body, close) => {
    mountForm(body.querySelector('form'), d, 'edit', () => { close(); render(); });
  });
}

// =============================================================
//  入力画面
// =============================================================
function viewInput(v) {
  setTitle('入力');
  if (!activeAccounts().length) {
    v.innerHTML = `<section class="card"><p>先に「通帳・現金」で保管先を登録してください。</p>
      <button class="btn primary big" id="goacc">保管先を登録する</button></section>`;
    $('#goacc').onclick = () => { go('accounts'); setTimeout(() => editAccount(null), 50); };
    return;
  }
  if (!S.draft) S.draft = newDraft('expense');
  v.innerHTML = '<form class="tx-form card" onsubmit="return false"></form>';
  mountForm(v.querySelector('form'), S.draft, 'new', () => {
    const prev = S.draft;
    S.draft = newDraft(prev.type === T.ADJUST ? 'expense' : prev.type);
    render();
  });
}

// =============================================================
//  履歴
// =============================================================
function histRange() {
  const h = S.hist, t = L.today();
  switch (h.period) {
    case 'thisMonth': return L.periodRange('month', t);
    case 'lastMonth': return L.periodRange('month', L.addMonths(t, -1));
    case 'thisWeek': return L.periodRange('week', t);
    case 'custom': return { start: h.start, end: h.end };
    default: return { start: '', end: '' };
  }
}
function catOptions(sel, withIncome = true) {
  const og = (kind, label) => `<optgroup label="${label}">${catsOf(kind, true).map((c) => `<option value="${c.id}" ${sel === c.id ? 'selected' : ''}>${esc(c.name)}${c.archived ? '（非表示）' : ''}</option>`).join('')}</optgroup>`;
  return og('expense', '支出') + (withIncome ? og('income', '収入') : '');
}
function accOptions(sel) {
  return S.accounts.map((a) => `<option value="${a.id}" ${sel === a.id ? 'selected' : ''}>${esc(a.name)}${a.archived ? '（非表示）' : ''}</option>`).join('');
}

function viewHistory(v) {
  const h = S.hist;
  setTitle('履歴');
  const r = histRange();
  const list = L.filterTxs(S.txs, { ...h, start: r.start, end: r.end }, catName);
  const sm = L.summarize(list, {});
  const nFilters = [h.period !== 'all', h.type, h.categoryId, h.accountId].filter(Boolean).length;

  let groups = '', lastDate = null, shown = 0;
  for (const t of list) {
    if (shown >= h.limit) break;
    if (t.date !== lastDate) {
      if (lastDate) groups += '</div>';
      const dayExp = list.filter((x) => x.date === t.date && x.type === T.EXPENSE).reduce((s, x) => s + x.amount, 0);
      groups += `<div class="day-head"><span>${L.fmtDate(t.date, t.date.slice(0, 4) !== L.today().slice(0, 4))}</span>${dayExp ? `<span class="num">支出 ${yen(dayExp)}</span>` : ''}</div><div class="tx-list">`;
      lastDate = t.date;
    }
    groups += txRow(t); shown++;
  }
  if (lastDate) groups += '</div>';

  v.innerHTML = `
  <div class="search-bar">
    <label class="search">${icon('search')}<input type="search" id="h-q" placeholder="店名・メモ・カテゴリで検索" value="${esc(h.q)}"></label>
    <button class="icon-btn ${nFilters ? 'badge-dot' : ''}" id="h-fbtn" aria-label="絞り込み">${icon('filter')}${nFilters ? `<i>${nFilters}</i>` : ''}</button>
  </div>
  <div class="filters card ${h.open ? '' : 'hidden'}" id="h-filters">
    <label>期間<select id="h-period">
      ${[['all', 'すべて'], ['thisWeek', '今週'], ['thisMonth', '今月'], ['lastMonth', '先月'], ['custom', '日付を指定']].map(([k, l]) => `<option value="${k}" ${h.period === k ? 'selected' : ''}>${l}</option>`).join('')}
    </select></label>
    ${h.period === 'custom' ? `<div class="row"><input type="date" id="h-start" value="${h.start}"><span>〜</span><input type="date" id="h-end" value="${h.end}"></div>` : ''}
    <label>種別<select id="h-type"><option value="">すべて</option>${Object.entries(L.TYPE_LABEL).map(([k, l]) => `<option value="${k}" ${h.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>カテゴリ<select id="h-cat"><option value="">すべて</option>${catOptions(h.categoryId)}</select></label>
    <label>保管先<select id="h-acc"><option value="">すべて</option>${accOptions(h.accountId)}</select></label>
    <div class="row between"><button class="link" id="h-clear">条件をクリア</button><button class="link" id="h-csv">この条件でCSV書き出し</button></div>
  </div>
  <div class="hist-sum small"><span>${list.length}件</span><span>収入 <b class="inc-c num">${yen(sm.income)}</b></span><span>支出 <b class="exp-c num">${yen(sm.expense)}</b></span></div>
  ${list.length ? `<section class="card flush">${groups}</section>` : '<p class="empty">該当する取引がありません</p>'}
  ${list.length > h.limit ? '<button class="btn ghost block" id="h-more">さらに表示</button>' : ''}`;

  const q = $('#h-q');
  q.addEventListener('input', () => {
    h.q = q.value; clearTimeout(viewHistory.t);
    viewHistory.t = setTimeout(() => { const pos = q.selectionStart; render(); const n = $('#h-q'); n.focus(); n.setSelectionRange(pos, pos); }, 250);
  });
  $('#h-fbtn').onclick = () => { h.open = !h.open; $('#h-filters').classList.toggle('hidden', !h.open); };
  const bindSel = (id, key, after) => $(id) && ($(id).onchange = (e) => { h[key] = e.target.value; after && after(); h.limit = 150; render(); });
  bindSel('#h-period', 'period', () => { if (h.period === 'custom' && !h.start) { h.start = L.monthStart(L.today()); h.end = L.today(); } });
  bindSel('#h-start', 'start'); bindSel('#h-end', 'end');
  bindSel('#h-type', 'type'); bindSel('#h-cat', 'categoryId'); bindSel('#h-acc', 'accountId');
  $('#h-clear').onclick = () => { Object.assign(h, { q: '', period: 'all', start: '', end: '', type: '', categoryId: '', accountId: '' }); render(); };
  $('#h-csv').onclick = () => exportCSV(list);
  $('#h-more') && ($('#h-more').onclick = () => { h.limit += 300; render(); });
  bindTxRows(v);
}

// =============================================================
//  集計
// =============================================================
function barChart(data, key, color) {
  const n = data.length, W = 340, H = 160, top = 16, bottom = 22, left = 2, right = 2;
  const max = Math.max(1, ...data.map((d) => d[key]));
  const cw = (W - left - right) / n, bw = Math.max(2, cw * 0.66);
  const step = Math.ceil(n / 6);
  let bars = '';
  data.forEach((d, i) => {
    const x = left + cw * i + (cw - bw) / 2;
    const h = ((H - top - bottom) * d[key]) / max;
    bars += `<rect x="${x.toFixed(1)}" y="${(H - bottom - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, d[key] ? 1.5 : 0).toFixed(1)}" rx="1.5" fill="${color}"><title>${esc(d.label)} ${yen(d[key])}</title></rect>`;
    if (i % step === 0 || i === n - 1) {
      if (i !== n - 1 && n - 1 - i < step * 0.6) return;        // 最後のラベルと重なるものは省く
      const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
      const tx = i === 0 ? x : i === n - 1 ? x + bw : x + bw / 2;
      bars += `<text x="${tx.toFixed(1)}" y="${H - 6}" text-anchor="${anchor}">${esc(d.short || d.label)}</text>`;
    }
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="支出の推移グラフ">
    <line x1="0" x2="${W}" y1="${H - bottom}" y2="${H - bottom}" class="axis"/>
    <line x1="0" x2="${W}" y1="${top}" y2="${top}" class="grid"/>
    <text x="0" y="${top - 4}" class="maxl">最大 ${esc(yen(max))}</text>${bars}</svg>`;
}
function diffText(cur, prev, invert = false) {
  const d = cur - prev;
  if (d === 0) return '<span class="muted">±0円</span>';
  const pct = prev > 0 ? Math.round((d / prev) * 100) : null;
  const bad = invert ? d > 0 : d < 0;
  return `<span class="${bad ? 'exp-c' : 'inc-c'}">${yen(d, true)}</span>${pct !== null ? `<br><span class="muted">${pct > 0 ? '+' : ''}${pct}%</span>` : ''}`;
}

function viewSummary(v) {
  const s = S.sum;
  setTitle('集計');
  const range = s.mode === 'custom' ? L.periodRange('custom', s.cStart, s.cEnd) : L.periodRange(s.mode, s.anchor);
  const prev = L.previousRange(s.mode, range);
  const f = { categoryId: s.categoryId, accountId: s.accountId };
  const cur = L.summarize(S.txs, { ...range, ...f });
  const pre = L.summarize(S.txs, { ...prev, ...f });
  const prevLabel = s.mode === 'week' ? '前週比' : s.mode === 'month' ? '前月比' : '前の期間比';
  const ser = L.series(S.txs, s.gran, range, f);
  const list = L.filterTxs(S.txs, { start: range.start, end: range.end, categoryId: s.categoryId, accountId: s.accountId });
  const colors = ['#E8590C', '#1971C2', '#2F9E44', '#AE3EC9', '#F08C00', '#0C8599', '#E03131', '#5C7CFA', '#66A80F', '#868E96'];
  const isCur = s.mode !== 'custom' && range.start <= L.today() && L.today() <= range.end;

  v.innerHTML = `
  <div class="seg">${[['week', '週'], ['month', '月'], ['custom', '期間指定']].map(([k, l]) => `<button class="seg-b ${s.mode === k ? 'on' : ''}" data-mode="${k}">${l}</button>`).join('')}</div>
  ${s.mode === 'custom'
    ? `<div class="row period-custom"><input type="date" id="s-start" value="${s.cStart}"><span>〜</span><input type="date" id="s-end" value="${s.cEnd}"></div>`
    : `<div class="period-nav"><button class="icon-btn" data-nav="-1" aria-label="前へ">${icon('chevL')}</button>
       <div><b>${range.label}</b>${isCur ? '' : `<button class="link small" data-nav="0">${s.mode === 'week' ? '今週' : '今月'}へ</button>`}</div>
       <button class="icon-btn" data-nav="1" aria-label="次へ">${icon('chevR')}</button></div>`}
  <div class="row filters-inline">
    <select id="s-cat"><option value="">全カテゴリ</option>${catOptions(s.categoryId)}</select>
    <select id="s-acc"><option value="">全保管先</option>${accOptions(s.accountId)}</select>
  </div>

  <section class="card">
    <div class="trio">
      <div><div class="muted small">収入</div><div class="num big inc-c">${yen(cur.income)}</div><div class="tiny">${diffText(cur.income, pre.income)}</div></div>
      <div><div class="muted small">支出</div><div class="num big exp-c">${yen(cur.expense)}</div><div class="tiny">${diffText(cur.expense, pre.expense, true)}</div></div>
      <div><div class="muted small">収支</div><div class="num big ${cur.net < 0 ? 'exp-c' : ''}">${yen(cur.net, true)}</div><div class="tiny">${diffText(cur.net, pre.net)}</div></div>
    </div>
    <div class="tiny muted center cmp">小さい数字は${prevLabel}（${esc(prev.label)}：収入 ${yen(pre.income)}／支出 ${yen(pre.expense)}）</div>
  </section>

  <section class="card">
    <h3>カテゴリ別の支出</h3>
    ${cur.byCategory.length ? `<div class="stack">${cur.byCategory.map((c, i) => `<i style="width:${(c.ratio * 100).toFixed(2)}%;background:${colors[i % colors.length]}"></i>`).join('')}</div>
    <div class="cat-list">${cur.byCategory.map((c, i) => `<button class="cat-row" data-cat="${c.categoryId}">
      <span class="dot" style="background:${colors[i % colors.length]}"></span><span class="grow">${esc(catName(c.categoryId))}</span>
      <span class="muted small">${(c.ratio * 100).toFixed(1)}%</span><span class="num">${yen(c.amount)}</span></button>`).join('')}</div>`
    : '<p class="empty">この期間の支出はありません</p>'}
  </section>

  <section class="card">
    <div class="card-head"><h3>支出の推移</h3>
      <div class="seg small">${[['day', '日別'], ['week', '週別'], ['month', '月別']].map(([k, l]) => `<button class="seg-b ${s.gran === k ? 'on' : ''}" data-gran="${k}">${l}</button>`).join('')}</div></div>
    <div class="tiny muted">${s.gran === 'day' ? 'この期間の日ごと' : s.gran === 'week' ? '期間の終わりまでの8週間（月曜始まり）' : '期間の終わりまでの12か月'}</div>
    ${barChart(ser, 'expense', 'var(--exp)')}
    <details class="table-d"><summary>金額の一覧を見る</summary><table class="num-table">
      <tr><th></th><th>支出</th><th>収入</th></tr>
      ${[...ser].reverse().map((r) => `<tr><td>${esc(r.label)}</td><td class="num">${yen(r.expense)}</td><td class="num">${yen(r.income)}</td></tr>`).join('')}</table></details>
  </section>

  <section class="card flush">
    <details class="period-list"><summary class="pad">この期間の取引（${list.length}件）</summary>
      <div class="tx-list">${list.slice(0, 300).map(txRow).join('')}</div>
      ${list.length ? `<div class="pad"><button class="link" id="s-csv">この期間をCSV書き出し</button></div>` : ''}</details>
    <p class="tiny muted pad">※ 振替・残高調整・開始残高は、収入・支出に含めていません。</p>
  </section>`;

  v.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { s.mode = b.dataset.mode; if (s.mode === 'week' && s.gran === 'day') s.gran = 'day'; render(); }));
  v.querySelectorAll('[data-gran]').forEach((b) => (b.onclick = () => { s.gran = b.dataset.gran; render(); }));
  v.querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => {
    const n = +b.dataset.nav;
    if (n === 0) s.anchor = L.today();
    else s.anchor = s.mode === 'week' ? L.addDays(range.start, 7 * n) : L.addMonths(range.start, n);
    render();
  }));
  $('#s-start') && ($('#s-start').onchange = (e) => { s.cStart = e.target.value || s.cStart; render(); });
  $('#s-end') && ($('#s-end').onchange = (e) => { s.cEnd = e.target.value || s.cEnd; render(); });
  $('#s-cat').onchange = (e) => { s.categoryId = e.target.value; render(); };
  $('#s-acc').onchange = (e) => { s.accountId = e.target.value; render(); };
  v.querySelectorAll('[data-cat]').forEach((b) => (b.onclick = () => { s.categoryId = b.dataset.cat; render(); }));
  $('#s-csv') && ($('#s-csv').onclick = () => exportCSV(list));
  bindTxRows(v);
}

// =============================================================
//  通帳・現金（保管先・カテゴリ・データ管理）
// =============================================================
function viewAccounts(v) {
  setTitle('通帳・現金');
  const bal = balances();
  const accs = [...S.accounts].sort((a, b) => (a.archived - b.archived) || a.order - b.order);
  const cats = catsOf(S.catTab, true);
  const lb = S.meta.lastBackup;

  v.innerHTML = `
  <section class="card flush">
    <div class="card-head pad"><h3>お金の保管先</h3><button class="btn small primary" id="a-add">＋ 追加</button></div>
    ${accs.length ? accs.map((a) => `<div class="acc-manage ${a.archived ? 'archived' : ''}">
      <button class="acc-row" data-edit="${a.id}"><span class="acc-ic ${a.type}">${accIcon(a)}</span>
        <span class="acc-name">${esc(a.name)}${a.archived ? ' <span class="tag">非表示</span>' : ''}
          <span class="tiny muted block">開始 ${L.fmtDate(a.startDate, true)}　${yen(a.startBalance)}</span></span>
        <span class="num acc-bal ${bal.get(a.id) < 0 ? 'neg' : ''}">${yen(bal.get(a.id))}</span></button>
      ${a.archived ? '' : `<button class="btn ghost small adj-btn" data-adj="${a.id}">${icon('scale')}残高を合わせる</button>`}
    </div>`).join('') : '<p class="empty">まだ登録がありません。「＋ 追加」から登録してください。</p>'}
  </section>

  <section class="card">
    <div class="card-head"><h3>カテゴリ</h3>
      <div class="seg small">${[['expense', '支出'], ['income', '収入']].map(([k, l]) => `<button class="seg-b ${S.catTab === k ? 'on' : ''}" data-ctab="${k}">${l}</button>`).join('')}</div></div>
    <div class="cat-manage">${cats.map((c, i) => `<div class="cm-row ${c.archived ? 'archived' : ''}">
      <button class="grow left" data-cedit="${c.id}">${esc(c.name)}${c.archived ? ' <span class="tag">非表示</span>' : ''}</button>
      <button class="icon-btn small" data-cmove="${c.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="上へ">${icon('up')}</button>
      <button class="icon-btn small" data-cmove="${c.id}" data-dir="1" ${i === cats.length - 1 ? 'disabled' : ''} aria-label="下へ">${icon('dn')}</button>
    </div>`).join('')}</div>
    <button class="btn ghost block" id="c-add">＋ カテゴリを追加</button>
  </section>

  <section class="card">
    <h3>データの保存とバックアップ</h3>
    <p class="small">データはこの iPhone の中（このアプリ専用の保存領域）にだけ保存されます。外部には送信しません。</p>
    <div class="kv"><span>取引</span><b>${S.txs.length}件</b></div>
    <div class="kv"><span>最後のバックアップ</span><b>${lb ? esc(new Date(lb).toLocaleString('ja-JP')) : 'まだありません'}</b></div>
    <div class="kv"><span>保存の保護</span><b id="persist">確認中…</b></div>
    <label class="check"><input type="checkbox" id="b-img" checked> レシート画像も含める <span class="muted small" id="img-size"></span></label>
    <button class="btn primary block" id="b-export">バックアップを書き出す</button>
    <button class="btn ghost block" id="b-import">バックアップから復元</button>
    <button class="btn ghost block" id="b-csv">全取引をCSVで書き出す</button>
    <input type="file" id="b-file" accept=".json,application/json" hidden>
    <details class="small"><summary>データが消える可能性と対策</summary>
      <ul class="notes">
        <li>ホーム画面のアイコンを削除したり、「設定 → Safari → 履歴とWebサイトデータを消去」を行うと、データが消えます。</li>
        <li>機種変更しても自動では引き継がれません。古い iPhone でバックアップを書き出し、新しい iPhone で「復元」してください。</li>
        <li>書き出したファイルは「ファイル」アプリ（iCloud Drive がおすすめ）に保存してください。</li>
        <li>レシート画像を含めないバックアップは軽くなりますが、復元しても画像は戻りません。</li>
        <li>2週間以上バックアップしていないと、ホーム画面でお知らせします。</li>
      </ul></details>
  </section>

  <section class="card small muted">
    <b>このアプリについて</b><br>おかね帳 v${APP_VERSION}<br>
    レシート読み取りは iPhone の中で動く文字認識（Tesseract.js）を使っています。画像は外部に送信しません。認識の精度には限りがあるため、登録前に必ず内容を確認してください。
  </section>`;

  $('#a-add').onclick = () => editAccount(null);
  v.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => editAccount(b.dataset.edit)));
  v.querySelectorAll('[data-adj]').forEach((b) => (b.onclick = () => adjustBalance(b.dataset.adj)));
  v.querySelectorAll('[data-ctab]').forEach((b) => (b.onclick = () => { S.catTab = b.dataset.ctab; render(); }));
  v.querySelectorAll('[data-cedit]').forEach((b) => (b.onclick = () => editCategory(b.dataset.cedit)));
  v.querySelectorAll('[data-cmove]').forEach((b) => (b.onclick = () => moveCategory(b.dataset.cmove, +b.dataset.dir)));
  $('#c-add').onclick = () => editCategory(null);
  $('#b-export').onclick = () => exportBackup($('#b-img').checked);
  $('#b-import').onclick = () => $('#b-file').click();
  $('#b-file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importBackup(f); };
  $('#b-csv').onclick = () => exportCSV(S.txs);
  (async () => {
    let txt = '未対応';
    try { if (navigator.storage?.persisted) txt = (await navigator.storage.persisted()) ? '有効（自動削除されにくい状態）' : '標準（定期的なバックアップを推奨）'; } catch { /* */ }
    const el = $('#persist'); if (el) el.textContent = txt;
    const imgs = await DB.getAll('images');
    const size = imgs.reduce((s, i) => s + (i.buf?.byteLength || 0), 0);
    const el2 = $('#img-size'); if (el2) el2.textContent = `（画像${imgs.length}枚・約${(size / 1048576).toFixed(1)}MB）`;
  })();
}

function editAccount(id) {
  const a = id ? acc(id) : { id: null, name: '', type: 'bank', startDate: L.today(), startBalance: 0, archived: false };
  const used = id ? S.txs.some((t) => t.accountId === id || t.toAccountId === id) : false;
  const firstTx = id ? L.sortTxs(S.txs.filter((t) => t.accountId === id || t.toAccountId === id)).pop() : null;
  const body = `<form class="tx-form" onsubmit="return false">
    <div class="field"><div class="lbl">名前</div><input id="a-name" value="${esc(a.name)}" placeholder="例）○○銀行の通帳、財布の現金" autocomplete="off"></div>
    <div class="field"><div class="lbl">種類</div><div class="chips">${Object.entries(TYPE_ACC).map(([k, l]) =>
      `<button type="button" class="chip ${a.type === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div></div>
    <div class="field"><div class="lbl">開始日</div><input type="date" id="a-date" value="${a.startDate}">
      <div class="note">この日の時点の残高を「開始残高」に入れます。この日より前の取引は登録できません。</div></div>
    <div class="field"><div class="lbl">開始残高</div><div class="amount-box small"><input id="a-bal" inputmode="numeric" value="${(a.startBalance || 0).toLocaleString('ja-JP')}"><span>円</span></div>
      <div class="note">開始残高は収入として集計しません。</div></div>
    ${id ? `<label class="check"><input type="checkbox" id="a-arch" ${a.archived ? 'checked' : ''}> 使わなくなったので非表示にする</label>` : ''}
    <div class="err" id="a-err"></div>
    <div class="save-bar">${id ? `<button type="button" class="btn danger-ghost" id="a-del">削除</button>` : ''}
      <button type="button" class="btn primary big grow" id="a-save">${id ? '保存' : '登録する'}</button></div>
  </form>`;
  openSheet(id ? '保管先の編集' : '保管先の追加', body, (el, close) => {
    let type = a.type;
    el.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => {
      type = b.dataset.t; el.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('on', x === b));
    }));
    const balIn = $('#a-bal', el);
    balIn.addEventListener('input', () => {
      const neg = /^[-−ー]/.test(balIn.value.trim());
      const dg = balIn.value.normalize('NFKC').replace(/[^\d]/g, '').slice(0, 11);
      balIn.value = dg ? (neg ? '-' : '') + parseInt(dg, 10).toLocaleString('ja-JP') : (neg ? '-' : '');
    });
    $('#a-save', el).onclick = async () => {
      const name = $('#a-name', el).value.trim();
      const startDate = $('#a-date', el).value;
      const sb = L.parseAmount(balIn.value || '0');
      const errEl = $('#a-err', el);
      if (!name) return (errEl.textContent = '名前を入力してください');
      if (!L.isValidYmd(startDate)) return (errEl.textContent = '開始日を入力してください');
      if (Number.isNaN(sb)) return (errEl.textContent = '開始残高を数字で入力してください');
      if (firstTx && startDate > firstTx.date) return (errEl.textContent = `開始日より前の取引（${L.fmtDate(firstTx.date, true)}）があるため、その日以前にしてください`);
      const archived = $('#a-arch', el)?.checked || false;
      if (archived && !a.archived) {
        const b = balances().get(id) || 0;
        if (b !== 0 && !(await ask({ title: '残高が残っています', message: `残高 ${yen(b)} は合計残高に含まれなくなります。非表示にしますか？`, ok: '非表示にする' }))) return;
      }
      const v = { ...a, id: a.id || uid(), name, type, startDate, startBalance: sb, archived, order: a.id ? a.order : S.accounts.length };
      await DB.put('accounts', v);
      S.accounts = S.accounts.filter((x) => x.id !== v.id).concat(v);
      requestPersist();
      close(); render();
      toast(id ? '保存しました' : `「${name}」を登録しました`);
    };
    $('#a-del', el) && ($('#a-del', el).onclick = async () => {
      if (used) {
        await ask({ title: '削除できません', message: 'この保管先を使った取引があります。使わなくなった場合は「非表示にする」を選んでください。', cancel: '', ok: 'OK' });
        return;
      }
      if (!(await ask({ title: `「${a.name}」を削除しますか？`, ok: '削除', danger: true }))) return;
      await DB.del('accounts', id);
      S.accounts = S.accounts.filter((x) => x.id !== id);
      close(); render();
    });
  });
}

function adjustBalance(id) {
  const a = acc(id);
  let date = L.today();
  const body = `<form class="tx-form" onsubmit="return false">
    <p class="small">実際の残高（通帳の記帳額や、財布の中の金額）を入力すると、差額を「残高調整」として記録します。収入・支出には含めません。</p>
    <div class="field"><div class="lbl">日付</div><input type="date" id="j-date" value="${date}"></div>
    <div class="kv"><span>アプリ上の残高</span><b class="num" id="j-app"></b></div>
    <div class="field"><div class="lbl">実際の残高</div><div class="amount-box"><input id="j-real" inputmode="numeric" placeholder="0"><span>円</span></div></div>
    <div class="kv"><span>調整額</span><b class="num" id="j-diff">—</b></div>
    <div class="field"><div class="lbl">理由（必須）</div><input id="j-memo" placeholder="例）財布の現金を数え直した、利息" autocomplete="off"></div>
    <div class="err" id="j-err"></div>
    <div class="save-bar"><button type="button" class="btn primary big grow" id="j-save">調整を登録</button></div></form>`;
  openSheet(`残高を合わせる：${a.name}`, body, (el, close) => {
    const appBal = () => L.accountBalances(S.accounts, S.txs, date).get(id) || 0;
    const realIn = $('#j-real', el);
    const upd = () => {
      $('#j-app', el).textContent = yen(appBal());
      const dg = realIn.value.normalize('NFKC').replace(/[^\d]/g, '');
      const neg = /^[-−]/.test(realIn.value.trim());
      if (!dg) { $('#j-diff', el).textContent = '—'; return null; }
      const real = parseInt(dg, 10) * (neg ? -1 : 1);
      const diff = real - appBal();
      $('#j-diff', el).textContent = yen(diff, true);
      return diff;
    };
    realIn.addEventListener('input', () => {
      const neg = /^[-−]/.test(realIn.value.trim());
      const dg = realIn.value.normalize('NFKC').replace(/[^\d]/g, '').slice(0, 11);
      realIn.value = dg ? (neg ? '-' : '') + parseInt(dg, 10).toLocaleString('ja-JP') : '';
      upd();
    });
    $('#j-date', el).onchange = (e) => { date = e.target.value; upd(); };
    upd();
    $('#j-save', el).onclick = async () => {
      const diff = upd();
      const errEl = $('#j-err', el);
      if (diff === null) return (errEl.textContent = '実際の残高を入力してください');
      if (diff === 0) return (errEl.textContent = '残高は合っています（調整は不要です）');
      const tx = { id: uid(), type: T.ADJUST, date, amount: diff, accountId: id, toAccountId: null, categoryId: null,
        payee: '', memo: $('#j-memo', el).value.trim(), items: [], receiptHash: '', imageId: null, createdAt: Date.now(), updatedAt: Date.now() };
      const v = L.validateTx(tx, S.accounts);
      if (v) return (errEl.textContent = v);
      await DB.put('txs', tx);
      S.txs.push(tx);
      close(); render();
      toast(`残高調整 ${yen(diff, true)} を登録しました`);
    };
  });
}

function editCategory(id) {
  const c = id ? cat(id) : { id: null, kind: S.catTab, name: '', archived: false };
  const used = id ? S.txs.some((t) => t.categoryId === id) : false;
  const body = `<form class="tx-form" onsubmit="return false">
    <div class="field"><div class="lbl">${c.kind === 'income' ? '収入' : '支出'}のカテゴリ名</div><input id="c-name" value="${esc(c.name)}" autocomplete="off"></div>
    ${id ? `<label class="check"><input type="checkbox" id="c-arch" ${c.archived ? 'checked' : ''}> 入力画面に表示しない</label>` : ''}
    ${id && used ? '<p class="note">名前を変えると、過去の取引にも新しい名前で表示されます。</p>' : ''}
    <div class="err" id="c-err"></div>
    <div class="save-bar">${id ? '<button type="button" class="btn danger-ghost" id="c-del">削除</button>' : ''}
    <button type="button" class="btn primary big grow" id="c-save">保存</button></div></form>`;
  openSheet(id ? 'カテゴリの編集' : 'カテゴリの追加', body, (el, close) => {
    $('#c-save', el).onclick = async () => {
      const name = $('#c-name', el).value.trim();
      if (!name) return ($('#c-err', el).textContent = '名前を入力してください');
      if (catsOf(c.kind, true).some((x) => x.name === name && x.id !== id)) return ($('#c-err', el).textContent = '同じ名前があります');
      const v = { ...c, id: c.id || uid(), name, archived: $('#c-arch', el)?.checked || false, order: c.id ? c.order : catsOf(c.kind, true).length };
      await DB.put('categories', v);
      S.categories = S.categories.filter((x) => x.id !== v.id).concat(v);
      close(); render();
    };
    $('#c-del', el) && ($('#c-del', el).onclick = async () => {
      if (used) { await ask({ title: '削除できません', message: 'このカテゴリを使った取引があります。「入力画面に表示しない」で隠せます。', cancel: '', ok: 'OK' }); return; }
      if (!(await ask({ title: `「${c.name}」を削除しますか？`, ok: '削除', danger: true }))) return;
      await DB.del('categories', id);
      S.categories = S.categories.filter((x) => x.id !== id);
      close(); render();
    });
  });
}
async function moveCategory(id, dir) {
  const list = catsOf(cat(id).kind, true);
  const i = list.findIndex((c) => c.id === id), j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  list.forEach((c, k) => (c.order = k));
  await DB.write(list.map((c) => ({ store: 'categories', value: c })));
  render();
}

// ---------------------------------------------------------------- バックアップ・CSV
function bufToB64(buf) {
  const bytes = new Uint8Array(buf); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBuf(b64) {
  const s = atob(b64); const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u.buffer;
}
export async function buildBackup(includeImages) {
  const meta = (await DB.getAll('meta')).filter((m) => m.key !== 'lastBackup');
  const images = includeImages ? (await DB.getAll('images')).map((i) => ({ id: i.id, type: i.type, data: bufToB64(i.buf) })) : [];
  return {
    app: 'okane-cho', format: 1, version: APP_VERSION, exportedAt: new Date().toISOString(),
    includesImages: !!includeImages,
    accounts: S.accounts, categories: S.categories, txs: S.txs, meta, images,
  };
}
async function exportBackup(includeImages) {
  const data = await buildBackup(includeImages);
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const ok = await saveFile(blob, `okane-backup-${stamp()}${includeImages ? '' : '-noimg'}.json`);
  if (ok) {
    await setMeta('lastBackup', new Date().toISOString());
    toast('バックアップを書き出しました');
    render();
  }
}
export async function restoreBackup(data) {
  if (data?.app !== 'okane-cho' || !Array.isArray(data.accounts) || !Array.isArray(data.txs)) throw new Error('このアプリのバックアップファイルではありません');
  await DB.replaceAll({
    accounts: data.accounts, categories: data.categories || [], txs: data.txs,
    meta: [...(data.meta || []), { key: 'lastBackup', value: data.exportedAt }],
    images: (data.images || []).map((i) => ({ id: i.id, type: i.type, buf: b64ToBuf(i.data) })),
  });
  imgURLs.clear();
  S.accounts = []; S.categories = []; S.txs = []; S.meta = { lastAccount: {} };
  await load();
}
async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { await ask({ title: '読み込めませんでした', message: 'ファイルの形式が正しくありません。', cancel: '', ok: 'OK' }); return; }
  if (data?.app !== 'okane-cho') { await ask({ title: '読み込めませんでした', message: 'このアプリのバックアップファイルではありません。', cancel: '', ok: 'OK' }); return; }
  const ok = await ask({
    title: 'バックアップから復元しますか？',
    message: `書き出し日時：${esc(new Date(data.exportedAt).toLocaleString('ja-JP'))}<br>保管先 ${data.accounts.length}件・取引 ${data.txs.length}件・画像 ${(data.images || []).length}枚
      ${data.includesImages ? '' : '<br>（このバックアップにはレシート画像が含まれていません）'}<br><br><b>今このアプリにあるデータは、すべて置き換えられます。</b>`,
    ok: '復元する', danger: true,
  });
  if (!ok) return;
  try { await restoreBackup(data); } catch (e) { await ask({ title: '復元できませんでした', message: esc(e.message || e), cancel: '', ok: 'OK' }); return; }
  S.draft = null;
  toast('復元しました');
  go('home');
}
async function exportCSV(list) {
  if (!list.length) { toast('書き出す取引がありません'); return; }
  const blob = new Blob([L.toCSV(list, S.accounts, S.categories)], { type: 'text/csv' });
  if (await saveFile(blob, `okane-${stamp()}.csv`)) toast('CSVを書き出しました');
}

// ---------------------------------------------------------------- 起動
async function boot() {
  try {
    await load();
  } catch (e) {
    $('#view').innerHTML = `<section class="card"><h3>データを読み込めませんでした</h3><p class="small">${esc(e.message || e)}</p>
      <p class="small">プライベートブラウズでは保存できません。通常のSafariで開いてください。</p></section>`;
    return;
  }
  window.addEventListener('hashchange', route);
  route();
  if (S.txs.length || S.accounts.length) requestPersist();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
// テスト用に公開
window.__okane = { S, DB, L, buildBackup, restoreBackup, load };
boot();
