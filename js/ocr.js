// =============================================================
//  レシート読み取り（端末内OCR）
//  Tesseract.js（WebAssembly）を iPhone の中で動かす。
//  画像は外部へ送信しない。必要なファイルはこのアプリと同じ場所に同梱。
// =============================================================
let worker = null;
let loading = null;

const abs = (p) => new URL(p, location.href).href;

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('読み取り機能のファイルを読み込めませんでした'));
    document.head.appendChild(s);
  });
}

async function getWorker(onProgress) {
  if (worker) return worker;
  if (!loading) {
    loading = (async () => {
      if (!window.Tesseract) await loadScript(abs('vendor/tesseract/tesseract.min.js'));
      const w = await window.Tesseract.createWorker('jpn', 1, {
        workerPath: abs('vendor/tesseract/worker.min.js'),
        corePath: abs('vendor/tesseract-core/'),
        langPath: abs('vendor/tessdata/'),
        workerBlobURL: false,
        gzip: true,
        logger: (m) => onProgress && onProgress(m),
      });
      await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
      worker = w;
      return w;
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

/** 画像ファイル → 読みやすく前処理した canvas */
export async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function preprocess(img) {
  // 長辺 2200px 程度に揃え、グレースケール＋コントラスト補正
  const maxSide = 2200, minW = 1000;
  let w = img.naturalWidth, h = img.naturalHeight;
  let k = Math.min(1, maxSide / Math.max(w, h));
  if (w * k < minW) k = Math.min(minW / w, 2.5);
  w = Math.round(w * k); h = Math.round(h * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  const px = d.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
    px[i] = g; hist[g]++;
  }
  // 上下 1% を切り捨てて明るさを伸ばす
  const total = w * h; let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.01) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * 0.01) { hi = v; break; } }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((px[i] - lo) * 255) / span));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

/** 画像から文字を読み取る。戻り値はテキスト */
export async function recognizeReceipt(img, onProgress) {
  const w = await getWorker(onProgress);
  const canvas = preprocess(img);
  const { data } = await w.recognize(canvas);
  return data.text || '';
}

/** 添付用に画像を縮小（JPEG） → { buf, type, w, h } */
export async function compressImage(img, maxSide = 1600, quality = 0.72) {
  let w = img.naturalWidth, h = img.naturalHeight;
  const k = Math.min(1, maxSide / Math.max(w, h));
  w = Math.round(w * k); h = Math.round(h * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
  return { buf: await blob.arrayBuffer(), type: 'image/jpeg', w, h };
}

/** 同じ画像の判定用ハッシュ */
export async function hashFile(file) {
  try {
    const buf = await file.arrayBuffer();
    const h = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return ''; }
}
