/**
 * 超分 WebView 内运行的处理脚本（分块推理 / tiled inference）。
 *
 * 为什么必须分块：
 *   端侧模型不能一次吃大图（内存、耗时都爆）。但把整图缩到 128~224px 再放大
 *   ＝先把原图细节丢掉再补，结果必然「糊」。正确做法是按 192px 的块切开，
 *   每块单独超分，再拼回大图 —— 这样输出能到 1536px 级别，才是真超分。
 *
 * 通信协议（postMessage 的 JSON）：
 *   WebView → RN：{kind:'ready',  total, outW, outH}
 *   WebView → RN：{kind:'tile',   idx, w, h, data}   data = RGB uint8 的 base64
 *   RN → WebView：{kind:'tileOut', idx, b64, w, h}   b64  = RGBA 的 base64
 *   RN → WebView：{kind:'tileErr', idx, error}
 *   WebView → RN：{kind:'progress', done, total}
 *   WebView → RN：{kind:'result', dataURL} | {kind:'result', error}
 */

import type {SRNormalization} from './models';

export interface SuperResHtmlOptions {
  /** 输入图最长边（像素）。实际分块在其中进行。 */
  maxSide: number;
  /** 归一化方式（按模型实测确定） */
  norm: SRNormalization;
  /** 模型倍率 */
  scale: number;
  /** 每块的核心边长（输入像素），默认 192 */
  core?: number;
  /** 块间重叠像素，避免拼接缝，默认 16 */
  overlap?: number;
  /** 原图 MIME（默认 image/jpeg） */
  mime?: string;
}

export function buildSuperResHtml(
  base64: string,
  opts: SuperResHtmlOptions,
): string {
  const {
    maxSide,
    norm,
    scale,
    core = 192,
    overlap = 16,
    mime = 'image/jpeg',
  } = opts;
  const nonce = Date.now();

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>html,body{margin:0;padding:0;background:transparent}
canvas{display:none}</style>
</head>
<body>
<canvas id="src"></canvas>
<canvas id="out"></canvas>
<canvas id="tmp"></canvas>
<canvas id="mask"></canvas>
<script>
/* super-res protocol v3 (tiled) — nonce ${nonce} */
(function(){
  var NORM = ${JSON.stringify(norm)};
  var MAXSIDE = ${maxSide};
  var SCALE = ${scale};
  var CORE = ${core};
  var OV = ${overlap};
  var src = "data:${mime};base64,${base64}";

  function post(obj){ window.ReactNativeWebView.postMessage(JSON.stringify(obj)); }

  function b64FromBytes(bytes){
    var CH = 0x8000, parts = [];
    for (var i = 0; i < bytes.length; i += CH) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CH)));
    }
    return btoa(parts.join(''));
  }
  function bytesFromB64(b){
    var s = atob(b), a = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  }

  var tiles = [];      // {idx, tx0, ty0, tx1, ty1, cx0, cy0, cx1, cy1}
  var cur = 0;
  var cancelled = false; // RN 侧点「停止」后置位
  var srcCtx, outCtx, tmpCv, tmpCtx, maskCv, maskCtx, inW, inH;

  function buildPlan(){
    var cols = Math.ceil(inW / CORE), rows = Math.ceil(inH / CORE);
    var idx = 0;
    for (var ry = 0; ry < rows; ry++) {
      for (var rx = 0; rx < cols; rx++) {
        var cx0 = rx * CORE, cy0 = ry * CORE;
        var cx1 = Math.min(inW, cx0 + CORE), cy1 = Math.min(inH, cy0 + CORE);
        tiles.push({
          idx: idx++,
          tx0: Math.max(0, cx0 - OV), ty0: Math.max(0, cy0 - OV),
          tx1: Math.min(inW, cx1 + OV), ty1: Math.min(inH, cy1 + OV),
          cx0: cx0, cy0: cy0, cx1: cx1, cy1: cy1
        });
      }
    }
  }

  function sendTile(){
    if (cancelled) { post({kind:'result', error:'已停止'}); return; }
    if (cur >= tiles.length) { finish(); return; }
    var t = tiles[cur];
    var tw = t.tx1 - t.tx0, th = t.ty1 - t.ty0;
    var px = srcCtx.getImageData(t.tx0, t.ty0, tw, th).data; // RGBA
    var rgb = new Uint8Array(tw * th * 3);
    for (var p = 0, q = 0; p < tw * th; p++) {
      rgb[q++] = px[p*4];
      rgb[q++] = px[p*4+1];
      rgb[q++] = px[p*4+2];
    }
    post({kind:'tile', idx: t.idx, w: tw, h: th, data: b64FromBytes(rgb)});
  }

  function onTileOut(msg){
    if (cancelled) { return; }
    var t = null;
    for (var i = 0; i < tiles.length; i++) { if (tiles[i].idx === msg.idx) { t = tiles[i]; break; } }
    if (!t) { return; }
    var W = msg.w, H = msg.h;
    var rgba = bytesFromB64(msg.b64);
    tmpCv.width = W; tmpCv.height = H;
    tmpCtx.putImageData(new ImageData(new Uint8ClampedArray(rgba), W, H), 0, 0);

    // 只把「核心区」贴到大图上；重叠边用**羽化混合**而不是硬裁，
    // 否则相邻块各算各的，边界会出现「断层」（看起来就是糊/花）。
    featherTile(t);
    var sx = (t.cx0 - t.tx0) * SCALE;
    var sy = (t.cy0 - t.ty0) * SCALE;
    var sw = (t.cx1 - t.cx0) * SCALE;
    var sh = (t.cy1 - t.cy0) * SCALE;
    outCtx.drawImage(tmpCv, sx, sy, sw, sh, t.cx0 * SCALE, t.cy0 * SCALE, sw, sh);

    cur++;
    post({kind:'progress', done: cur, total: tiles.length});
    sendTile();
  }

  /**
   * 给 tmpCv 加alpha羽化：在「与邻居重叠的四条边」上做透明渐变，
   * 这样多块叠加时会自然混色，看不到拼接缝。图片最外侧的边不羽化。
   */
  function featherTile(t){
    var W = tmpCv.width, H = tmpCv.height;
    var fL = t.tx0 > 0 ? OV * SCALE : 0;
    var fR = t.tx1 < inW ? OV * SCALE : 0;
    var fT = t.ty0 > 0 ? OV * SCALE : 0;
    var fB = t.ty1 < inH ? OV * SCALE : 0;
    if (!fL && !fR && !fT && !fB) { return; }

    maskCv.width = W; maskCv.height = H;
    var m = maskCtx;
    m.globalCompositeOperation = 'source-over';
    m.fillStyle = '#000';
    m.fillRect(0, 0, W, H);
    m.globalCompositeOperation = 'destination-out';

    if (fL) {
      var gl = m.createLinearGradient(0, 0, fL, 0);
      gl.addColorStop(0, 'rgba(0,0,0,1)');
      gl.addColorStop(1, 'rgba(0,0,0,0)');
      m.fillStyle = gl; m.fillRect(0, 0, fL, H);
    }
    if (fR) {
      var gr = m.createLinearGradient(W - fR, 0, W, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(1, 'rgba(0,0,0,1)');
      m.fillStyle = gr; m.fillRect(W - fR, 0, fR, H);
    }
    if (fT) {
      var gt = m.createLinearGradient(0, 0, 0, fT);
      gt.addColorStop(0, 'rgba(0,0,0,1)');
      gt.addColorStop(1, 'rgba(0,0,0,0)');
      m.fillStyle = gt; m.fillRect(0, 0, W, fT);
    }
    if (fB) {
      var gb = m.createLinearGradient(0, H - fB, 0, H);
      gb.addColorStop(0, 'rgba(0,0,0,0)');
      gb.addColorStop(1, 'rgba(0,0,0,1)');
      m.fillStyle = gb; m.fillRect(0, H - fB, W, fB);
    }

    tmpCtx.globalCompositeOperation = 'destination-in';
    tmpCtx.drawImage(maskCv, 0, 0);
    tmpCtx.globalCompositeOperation = 'source-over';
  }

  function finish(){
    try {
      // 用 JPEG 而不是 PNG：2560px 的 PNG 经 base64 过桥有 8MB+，
      // JPEG q0.95 大约 1/5，画质几乎看不出差别。
      post({kind:'result', dataURL: document.getElementById('out').toDataURL('image/jpeg', 0.95)});
    } catch (e) {
      post({kind:'result', error: '导出图片失败: ' + e});
    }
  }

  function start(){
    var img = new Image();
    img.onload = function(){
      try {
        var k = Math.min(1, MAXSIDE / Math.max(img.naturalWidth, img.naturalHeight));
        inW = Math.max(1, Math.round(img.naturalWidth * k));
        inH = Math.max(1, Math.round(img.naturalHeight * k));

        var sc = document.getElementById('src');
        sc.width = inW; sc.height = inH;
        srcCtx = sc.getContext('2d', {willReadFrequently: true});
        srcCtx.imageSmoothingEnabled = true;
        srcCtx.imageSmoothingQuality = 'high';
        srcCtx.drawImage(img, 0, 0, inW, inH);

        var oc = document.getElementById('out');
        oc.width = inW * SCALE; oc.height = inH * SCALE;
        outCtx = oc.getContext('2d');
        tmpCv = document.getElementById('tmp');
        tmpCtx = tmpCv.getContext('2d');
        maskCv = document.getElementById('mask');
        maskCtx = maskCv.getContext('2d');

        buildPlan();
        post({kind:'ready', total: tiles.length, outW: oc.width, outH: oc.height});
        sendTile();
      } catch (e) {
        post({kind:'result', error: '预处理失败: ' + e});
      }
    };
    img.onerror = function(){ post({kind:'result', error:'图片解码失败'}); };
    img.src = src;
  }

  document.addEventListener('message', function(e){
    var msg;
    try { msg = JSON.parse(e.data); } catch (_) { return; }
    if (msg.kind === 'tileOut') {
      try { onTileOut(msg); } catch (err) { post({kind:'result', error:'拼接失败: ' + err}); }
    }
    if (msg.kind === 'tileErr') { post({kind:'result', error: msg.error}); }
    if (msg.kind === 'cancel') { cancelled = true; post({kind:'result', error:'已停止'}); }
  });

  function boot(){ if (window.ReactNativeWebView) start(); else setTimeout(boot, 30); }
  boot();
})();
</script>
</body>
</html>`;
}
