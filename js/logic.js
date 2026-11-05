// =============================================================
//  おかね帳 — 計算ロジック（画面に依存しない部分）
//  残高・集計・日付・CSV・レシート文字解析
// =============================================================

export const T = { EXPENSE: 'expense', INCOME: 'income', TRANSFER: 'transfer', ADJUST: 'adjust' };
export const TYPE_LABEL = { expense: '支出', income: '収入', transfer: '振替', adjust: '残高調整' };

export const DEFAULT_CATEGORIES = {
  expense: ['食費', '外食', '日用品', '交通費', '住居', '水道光熱費', '通信費', '医療', '教育', '趣味', '手数料', 'その他'],
  income: ['給与', '売上', 'その他'],
};

// ---------------------------------------------------------------- 日付
const pad = (n) => String(n).padStart(2, '0');
export function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function today() { return ymd(new Date()); }
export function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
export function isValidYmd(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  const d = parseYmd(s);
  return ymd(d) === s;
}
/** 月曜始まりの週の初日 */
export function weekStart(s) {
  const d = parseYmd(s);
  const dow = (d.getDay() + 6) % 7;          // 月=0 … 日=6
  d.setDate(d.getDate() - dow);
  return ymd(d);
}
export function monthStart(s) { return s.slice(0, 8) + '01'; }
export function monthEnd(s) { const d = parseYmd(monthStart(s)); d.setMonth(d.getMonth() + 1); d.setDate(0); return ymd(d); }
export function addMonths(s, n) {
  const d = parseYmd(monthStart(s)); d.setMonth(d.getMonth() + n); return ymd(d);
}
export function daysBetween(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / 86400000); }
const WD = ['日', '月', '火', '水', '木', '金', '土'];
export function weekday(s) { return WD[parseYmd(s).getDay()]; }
export function fmtDate(s, withYear = false) {
  const [y, m, d] = s.split('-').map(Number);
  return `${withYear ? y + '年' : ''}${m}月${d}日(${weekday(s)})`;
}
export function fmtShort(s) { const [, m, d] = s.split('-').map(Number); return `${m}/${d}`; }

/** 集計期間 mode: 'week' | 'month' | 'custom' */
export function periodRange(mode, anchor, customEnd) {
  if (mode === 'week') {
    const start = weekStart(anchor), end = addDays(start, 6);
    return { start, end, label: `${fmtShort(start)}(月)〜${fmtShort(end)}(日)` };
  }
  if (mode === 'month') {
    const start = monthStart(anchor), end = monthEnd(anchor);
    const [y, m] = start.split('-').map(Number);
    return { start, end, label: `${y}年${m}月` };
  }
  const start = anchor <= customEnd ? anchor : customEnd;
  const end = anchor <= customEnd ? customEnd : anchor;
  return { start, end, label: `${fmtShort(start)}〜${fmtShort(end)}` };
}
/** 比較対象の前の期間 */
export function previousRange(mode, range) {
  if (mode === 'week') return periodRange('week', addDays(range.start, -7));
  if (mode === 'month') return periodRange('month', addMonths(range.start, -1));
  const len = daysBetween(range.start, range.end) + 1;
  const end = addDays(range.start, -1);
  return periodRange('custom', addDays(end, -(len - 1)), end);
}

// ---------------------------------------------------------------- 金額
export function fmtYen(n, sign = false) {
  const v = Math.round(n || 0);
  const s = Math.abs(v).toLocaleString('ja-JP');
  if (sign) return (v > 0 ? '+' : v < 0 ? '−' : '') + s + '円';
  return (v < 0 ? '−' : '') + s + '円';
}
export function parseAmount(str) {
  const s = String(str ?? '').normalize('NFKC').replace(/[,，\s円¥]/g, '');
  if (!/^-?\d+$/.test(s)) return NaN;
  return parseInt(s, 10);
}

// ---------------------------------------------------------------- 残高
/** 各保管先の残高。開始日より前の取引は開始残高に含まれているものとして数えない */
export function accountBalances(accounts, txs, asOf = null) {
  const map = new Map();
  const start = new Map();
  for (const a of accounts) { map.set(a.id, a.startBalance || 0); start.set(a.id, a.startDate); }
  const add = (id, v, date) => {
    if (!map.has(id)) return;
    if (date < start.get(id)) return;
    map.set(id, map.get(id) + v);
  };
  for (const t of txs) {
    if (asOf && t.date > asOf) continue;
    switch (t.type) {
      case T.EXPENSE: add(t.accountId, -t.amount, t.date); break;
      case T.INCOME: add(t.accountId, t.amount, t.date); break;
      case T.TRANSFER: add(t.accountId, -t.amount, t.date); add(t.toAccountId, t.amount, t.date); break;
      case T.ADJUST: add(t.accountId, t.amount, t.date); break;
    }
  }
  return map;
}
export function totalBalance(accounts, txs) {
  let s = 0;
  for (const [id, v] of accountBalances(accounts, txs)) {
    const a = accounts.find((x) => x.id === id);
    if (a && !a.archived) s += v;
  }
  return s;
}

/** 取引の入力チェック。問題なければ null */
export function validateTx(t, accounts) {
  const acc = (id) => accounts.find((a) => a.id === id);
  if (!isValidYmd(t.date)) return '日付を入力してください';
  if (t.type === T.ADJUST) {
    if (!Number.isInteger(t.amount) || t.amount === 0) return '調整額を入力してください';
    if (!(t.memo || '').trim()) return '調整の理由を入力してください';
  } else if (!Number.isInteger(t.amount) || t.amount <= 0) return '金額を入力してください';
  if (t.amount > 1e11 || t.amount < -1e11) return '金額が大きすぎます';
  const a = acc(t.accountId);
  if (!a) return t.type === T.TRANSFER ? '出金元を選んでください' : t.type === T.INCOME ? '入金先を選んでください' : t.type === T.EXPENSE ? '支払い元を選んでください' : '保管先を選んでください';
  if (t.date < a.startDate) return `「${a.name}」の開始日（${fmtDate(a.startDate, true)}）より前の日付です`;
  if (t.type === T.TRANSFER) {
    const b = acc(t.toAccountId);
    if (!b) return '入金先を選んでください';
    if (a.id === b.id) return '出金元と入金先が同じです';
    if (t.date < b.startDate) return `「${b.name}」の開始日（${fmtDate(b.startDate, true)}）より前の日付です`;
  }
  if ((t.type === T.EXPENSE || t.type === T.INCOME) && !t.categoryId) return 'カテゴリを選んでください';
  return null;
}

// ---------------------------------------------------------------- 絞り込み・集計
export function sortTxs(txs) {
  return [...txs].sort((a, b) => (a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : a.date < b.date ? 1 : -1));
}
const norm = (s) => (s || '').normalize('NFKC').toLowerCase();
export function filterTxs(txs, f = {}, catName = () => '') {
  const q = norm(f.q).trim();
  return sortTxs(txs.filter((t) => {
    if (f.start && t.date < f.start) return false;
    if (f.end && t.date > f.end) return false;
    if (f.type && t.type !== f.type) return false;
    if (f.categoryId && t.categoryId !== f.categoryId) return false;
    if (f.accountId && t.accountId !== f.accountId && t.toAccountId !== f.accountId) return false;
    if (q) {
      const hay = norm([t.payee, t.memo, catName(t.categoryId), ...(t.items || []).map((i) => i.name)].join(' '));
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  }));
}

/** 収入・支出の集計（振替・残高調整・開始残高は含めない） */
export function summarize(txs, { start, end, categoryId, accountId } = {}) {
  let income = 0, expense = 0, count = 0;
  const byCat = new Map();
  for (const t of txs) {
    if (t.type !== T.EXPENSE && t.type !== T.INCOME) continue;
    if (start && t.date < start) continue;
    if (end && t.date > end) continue;
    if (categoryId && t.categoryId !== categoryId) continue;
    if (accountId && t.accountId !== accountId) continue;
    count++;
    if (t.type === T.INCOME) income += t.amount;
    else {
      expense += t.amount;
      byCat.set(t.categoryId, (byCat.get(t.categoryId) || 0) + t.amount);
    }
  }
  const byCategory = [...byCat].map(([categoryId, amount]) => ({ categoryId, amount, ratio: expense ? amount / expense : 0 }))
    .sort((a, b) => b.amount - a.amount);
  return { income, expense, net: income - expense, count, byCategory };
}

/** 推移データ gran: 'day' | 'week' | 'month' */
export function series(txs, gran, range, filters = {}) {
  const buckets = [];
  if (gran === 'day') {
    for (let d = range.start; d <= range.end; d = addDays(d, 1)) buckets.push({ start: d, end: d, label: fmtShort(d) });
  } else if (gran === 'week') {
    let s = weekStart(range.end);
    for (let i = 0; i < 8; i++) { buckets.unshift({ start: s, end: addDays(s, 6), label: fmtShort(s) + '〜', short: fmtShort(s) }); s = addDays(s, -7); }
  } else {
    let s = monthStart(range.end);
    for (let i = 0; i < 12; i++) {
      const [y, m] = s.split('-').map(Number);
      buckets.unshift({ start: s, end: monthEnd(s), label: `${y}年${m}月`, short: m === 1 || i === 11 ? `${String(y).slice(2)}/${m}月` : `${m}月` });
      s = addMonths(s, -1);
    }
  }
  return buckets.map((b) => {
    const r = summarize(txs, { ...filters, start: b.start, end: b.end });
    return { ...b, expense: r.expense, income: r.income };
  });
}

/** よく使う順（直近 days 日の利用回数） */
export function usageCounts(txs, key, days = 180) {
  const from = addDays(today(), -days);
  const m = new Map();
  for (const t of txs) {
    if (t.date < from) continue;
    const ids = key === 'account' ? [t.accountId, t.toAccountId] : [t.categoryId];
    for (const id of ids) if (id) m.set(id, (m.get(id) || 0) + 1);
  }
  return m;
}

/** 同じレシートの二重登録の疑い */
export function findDuplicates(txs, d, excludeId) {
  return txs.filter((t) => {
    if (t.id === excludeId || t.type !== T.EXPENSE) return false;
    if (d.receiptHash && t.receiptHash === d.receiptHash) return true;
    return t.date === d.date && t.amount === d.amount && (!d.payee || !t.payee || norm(t.payee) === norm(d.payee));
  });
}

// ---------------------------------------------------------------- CSV
export function toCSV(txs, accounts, categories) {
  const an = (id) => accounts.find((a) => a.id === id)?.name || '';
  const cn = (id) => categories.find((c) => c.id === id)?.name || '';
  const esc = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ['日付', '種別', '金額', '保管先', '振替先', 'カテゴリ', '店名・相手先', 'メモ', '明細'];
  const rows = sortTxs(txs).reverse().map((t) => [
    t.date, TYPE_LABEL[t.type], t.type === T.EXPENSE ? -t.amount : t.amount, an(t.accountId),
    t.type === T.TRANSFER ? an(t.toAccountId) : '', cn(t.categoryId), t.payee || '', t.memo || '',
    (t.items || []).map((i) => `${i.name} ${i.amount}`).join(' / '),
  ]);
  return '\uFEFF' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

// =============================================================
//  レシート文字解析
//  OCRで得た文字列から、日付・店名・合計・明細を取り出す。
//  status: 'ok' 読み取り / 'check' 要確認 / 'none' 未読取
// =============================================================
const CJK = '\\u3040-\\u30ff\\u3400-\\u9fff\\uff66-\\uff9f';
export function normalizeOcrText(text) {
  return (text || '').normalize('NFKC')
    .replace(/\r/g, '')
    .replace(new RegExp(`([${CJK}])[ \\t]+(?=[${CJK}])`, 'g'), '$1')   // 「合 計」→「合計」
    .replace(/[￥]/g, '¥')
    .replace(/(\d)\s*,\s*(\d{3})/g, '$1,$2')
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}

const MONEY_RE = /(?:[¥\\Yy][ ]?)?(-?\d{1,3}(?:[,.]\d{3})+|-?\d{1,7})(?:[ ]?円)?/g;
function moneyIn(line) {
  const out = [];
  // 日付・時刻・電話番号っぽい部分は除外してから数字を拾う
  const clean = line
    .replace(/\d{2,4}[\/.\-年]\d{1,2}[\/.\-月]\d{1,2}日?/g, ' ')
    .replace(/\d{1,2}:\d{2}(:\d{2})?/g, ' ')
    .replace(/\d{2,4}-\d{2,4}-\d{3,4}/g, ' ')
    .replace(/\d+(\.\d+)?\s*%/g, ' ')
    .replace(/\d+\s*(点|個|コ|ケ|枚|本|pt|P)\b/gi, ' ');
  for (const m of clean.matchAll(MONEY_RE)) {
    let s = m[1];
    if (/[.]\d{3}/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '');
    s = s.replace(/,/g, '');
    if (s.includes('.')) continue;
    const v = parseInt(s, 10);
    if (!Number.isFinite(v) || Math.abs(v) > 9999999) continue;
    const marked = /[¥\\Yy円]/.test(m[0]) || /,\d{3}/.test(m[1]);
    out.push({ value: v, marked });
  }
  return out;
}
const lastMoney = (line) => { const m = moneyIn(line); return m.length ? m[m.length - 1].value : null; };

const KW_TOTAL = /(総?合計|現計|お?買い?上げ?(?:金額|計)?|御?買上|ご?請求(?:金額|額)?|お?支払(?:い)?(?:金額|額|合計)|お?会計|領収金額|税込合計)/;
const KW_NOT_TOTAL = /(小計|点数|預|釣|つり|対象|内税|消費税|税額|外税|税等|ポイント|値引|割引|クーポン|残高)/;
const KW_PAID = /(お?預り|お?預かり|預り金|お預)/;
const KW_CHANGE = /(お?釣り?|おつり|釣銭)/;
const KW_TAX = /(消費税|内税|外税|税額|税等)/;
const KW_SUBTOTAL = /小計/;

function parseDate(text, todayStr) {
  const t = today();
  const now = todayStr || t;
  const tries = [];
  for (const m of text.matchAll(/(20\d{2})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})/g)) tries.push({ y: +m[1], mo: +m[2], d: +m[3], strong: true });
  for (const m of text.matchAll(/令和\s*(\d{1,2}|元)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/g)) tries.push({ y: 2018 + (m[1] === '元' ? 1 : +m[1]), mo: +m[2], d: +m[3], strong: true });
  for (const m of text.matchAll(/\bR\s*(\d{1,2})[.\/年](\d{1,2})[.\/月](\d{1,2})/g)) tries.push({ y: 2018 + +m[1], mo: +m[2], d: +m[3], strong: false });
  for (const m of text.matchAll(/(?:^|[^\d])(\d{2})[\/.](\d{1,2})[\/.](\d{1,2})(?![\d])/gm)) tries.push({ y: 2000 + +m[1], mo: +m[2], d: +m[3], strong: false });   // 古いiOSのため後読みは使わない
  for (const c of tries) {
    const s = `${c.y}-${pad(c.mo)}-${pad(c.d)}`;
    if (!isValidYmd(s)) continue;
    if (s > addDays(now, 1)) continue;                    // 未来日は誤読
    if (s < addDays(now, -730)) continue;                 // 2年以上前も誤読扱い
    return { value: s, status: c.strong ? 'ok' : 'check' };
  }
  return { value: '', status: 'none' };
}

const SKIP_STORE = /(領収|レシート|receipt|いらっしゃいませ|ありがとう|またのご|TEL|Tel|電話|FAX|〒|登録番号|インボイス|No\.|№|レジ|責任者|担当|伝票|取引|お客様|様$|^\d|丁目|番地|[都道府県].*\d|[市区町村].*\d|http|www|\.com|\.jp)/;
function parseStore(lines) {
  const isReceipt = lines.some((l) => /領収書|領収証/.test(l));
  const corp = /(株式会社|有限会社|\(株\)|\(有\)|合同会社)/;
  const pool = isReceipt ? lines : lines.slice(0, 8);
  if (isReceipt) {
    const c = lines.find((l) => corp.test(l) && !/様/.test(l));
    if (c) return { value: c.replace(/^[^\p{L}]+|[^\p{L}\p{N})]+$/gu, ''), status: 'check' };
  }
  for (const l of pool.slice(0, 8)) {
    if (SKIP_STORE.test(l)) continue;
    const letters = (l.match(/[\p{L}]/gu) || []).length;
    if (letters < 2 || letters < l.length * 0.5) continue;
    if (KW_TOTAL.test(l) || KW_SUBTOTAL.test(l)) continue;
    return { value: l.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N})]+$/gu, '').slice(0, 40), status: 'check' };
  }
  return { value: '', status: 'none' };
}

const CATEGORY_RULES = [
  ['外食', /(レストラン|食堂|カフェ|喫茶|珈琲|コーヒー|ラーメン|らーめん|そば|うどん|寿司|すし|鮨|焼肉|焼鳥|居酒屋|定食|弁当屋|マクドナルド|スターバックス|STARBUCKS|ドトール|吉野家|すき家|松屋|ガスト|サイゼリヤ|モスバーガー|ケンタッキー|ミスタードーナツ|コメダ|タリーズ|丸亀|CoCo壱|餃子|バーガー|ピザ|ダイニング|キッチン)/i],
  ['日用品', /(マツモトキヨシ|ウエルシア|スギ薬局|ツルハ|ココカラ|サンドラッグ|コスモス|ドラッグ|ダイソー|セリア|キャンドゥ|無印良品|ニトリ|カインズ|コーナン|ホームセンター|DCM|100円ショップ)/i],
  ['医療', /(病院|医院|クリニック|歯科|調剤|薬局|眼科|内科|外科|皮膚科|整形|耳鼻|診療)/],
  ['交通費', /(駅|鉄道|JR|バス|タクシー|交通|ENEOS|エネオス|出光|コスモ石油|ガソリン|駐車|パーキング|高速|乗車)/i],
  ['食費', /(スーパー|イオン|AEON|イトーヨーカドー|ヨーカドー|西友|ライフ|マルエツ|サミット|業務スーパー|まいばすけっと|生協|コープ|成城石井|オーケー|ヤオコー|ベルク|青果|精肉|鮮魚|ベーカリー|セブン|ファミリーマート|ローソン|ミニストップ|デイリーヤマザキ|コンビニ|マート)/i],
  ['教育', /(書店|本屋|ブックス|紀伊國屋|丸善|ジュンク堂|文具|文房具|学習|塾)/],
  ['通信費', /(ドコモ|docomo|ソフトバンク|SoftBank|楽天モバイル|ワイモバイル|UQ)/i],
  ['水道光熱費', /(電力|ガス|水道局|上下水道)/],
];
function guessCategory(store, text) {
  for (const [name, re] of CATEGORY_RULES) if (re.test(store)) return { value: name, status: 'check' };
  const head = text.split('\n').slice(0, 10).join(' ');
  for (const [name, re] of CATEGORY_RULES) if (re.test(head)) return { value: name, status: 'check' };
  return { value: '', status: 'none' };
}

export function parseReceipt(rawText, todayStr) {
  const text = normalizeOcrText(rawText);
  const lines = text.split('\n');
  const res = {
    text,
    date: parseDate(text, todayStr),
    store: parseStore(lines),
    total: { value: null, status: 'none', note: '' },
    tax: null, paid: null, change: null, subtotal: null,
    items: [], itemsStatus: 'none',
    amounts: [],
  };

  const totals = [];
  let firstSumIdx = lines.length;
  lines.forEach((l, i) => {
    const v = lastMoney(l);
    const label = KW_SUBTOTAL.test(l) ? '小計' : KW_PAID.test(l) ? '預り' : KW_CHANGE.test(l) ? 'お釣り'
      : KW_TAX.test(l) ? '税' : (KW_TOTAL.test(l) && !KW_NOT_TOTAL.test(l)) ? '合計' : '';
    if (label && i < firstSumIdx && (label === '合計' || label === '小計')) firstSumIdx = i;
    if (v === null) return;
    if (label === '合計') totals.push(v);
    else if (label === '小計' && res.subtotal === null) res.subtotal = v;
    else if (label === '預り' && res.paid === null) res.paid = v;
    else if (label === 'お釣り' && res.change === null) res.change = v;
    else if (label === '税' && res.tax === null) res.tax = v;
    for (const m of moneyIn(l)) {
      if (m.value > 0 && (m.marked || label)) res.amounts.push({ value: m.value, label: label || '', line: l });
    }
  });
  // 金額候補（重複除去）
  const seen = new Set();
  res.amounts = res.amounts.filter((a) => { const k = a.value + a.label; if (seen.has(k)) return false; seen.add(k); return true; });

  const derived = res.paid !== null && res.change !== null && res.paid >= res.change ? res.paid - res.change : null;
  const uniq = [...new Set(totals.filter((v) => v > 0))];
  const T_ = res.total;
  if (uniq.length === 1) {
    T_.value = uniq[0];
    if (res.paid !== null && res.paid < T_.value) { T_.status = 'check'; T_.note = '預り金より合計が大きく、読み違いの可能性があります'; }
    else if (derived !== null && derived !== T_.value) { T_.status = 'check'; T_.note = `預り−お釣り（${derived.toLocaleString()}円）と一致しません`; }
    else T_.status = 'ok';
  } else if (uniq.length > 1) {
    // 「合計」が複数 → 預り−お釣りと一致するものがあれば採用、なければ要確認
    const hit = derived !== null ? uniq.find((v) => v === derived) : undefined;
    if (hit !== undefined) { T_.value = hit; T_.status = 'ok'; }
    else { T_.value = Math.max(...uniq); T_.status = 'check'; T_.note = '「合計」らしき金額が複数あります'; }
  } else if (derived !== null && derived > 0) {
    T_.value = derived; T_.status = 'check'; T_.note = '合計が読めなかったため、預り−お釣りから計算しました';
  } else {
    const kin = lines.map((l) => (/(金額|^金\s*[¥\\])/.test(l) ? lastMoney(l) : null)).find((v) => v);
    if (kin) { T_.value = kin; T_.status = 'check'; T_.note = '「金額」の行から読み取りました'; }
  }

  // 明細：最初の小計/合計より上で「名前 … 金額」の行
  const items = [];
  for (let i = 0; i < Math.min(firstSumIdx, lines.length); i++) {
    const l = lines[i];
    if (KW_NOT_TOTAL.test(l) && !/(値引|割引)/.test(l)) continue;
    if (/(TEL|電話|〒|登録番号|No\.|領収|レジ|担当)/.test(l)) continue;
    if (/[都道府県市区町村].*\d+-\d+/.test(l)) continue;      // 住所
    const m = l.match(/^(.*?[\p{L}].*?)\s*[¥\\Yy]?\s*(-?\d{1,3}(?:,\d{3})+|-?\d{1,6})\s*(?:円|※|\*|軽|外|内|T)?\s*$/u);
    if (!m) continue;
    const name = m[1].replace(/\s+[¥\\Yy]$/u, '').replace(/[¥\\@×*※\s]+$/u, '').trim();
    if ((name.match(/[\p{L}]/gu) || []).length < 2) continue;
    if (/\d{2,4}[\/年]\d{1,2}/.test(name)) continue;
    let v = parseInt(m[2].replace(/,/g, ''), 10);
    if (/(値引|割引)/.test(name) && v > 0) v = -v;
    items.push({ name: name.slice(0, 40), amount: v });
  }
  res.items = items;
  if (items.length) {
    const sum = items.reduce((s, i) => s + i.amount, 0);
    res.itemsStatus = (sum === res.subtotal || sum === T_.value) ? 'ok' : 'check';
  }
  res.category = guessCategory(res.store.value, text);
  return res;
}
