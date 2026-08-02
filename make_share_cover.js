// 生成微信分享封面 /assets/share-cover.png (1200x630)
// SoulMirror Luxury / Editorial 风格
// 背景 #F9F8F6  文字 #1A1A1A  点缀 #D4AF37
// 纯 Node 实现，无第三方依赖
// 使用超采样(SS=3)渲染文字，再双线性降采样，得到平滑抗锯齿的高端质感
const fs = require('fs');
const zlib = require('zlib');

// ---------- PNG 解码 ----------
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function decodePNG(path) {
  const data = fs.readFileSync(path);
  if (data.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < data.length) {
    const len = data.readUInt32BE(pos);
    const type = data.toString('ascii', pos + 4, pos + 8);
    const chunk = data.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
    } else if (type === 'IDAT') {
      idat.push(chunk);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 4;
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = raw.slice(rp, rp + stride);
    rp += stride;
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      cur[x] = v;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, channels, data: out };
}

// ---------- PNG 编码 ----------
function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- 位图字体 (5x7) ----------
const FONT = {
  A: [0b01110,0b10001,0b10001,0b11111,0b10001,0b10001,0b10001],
  B: [0b11110,0b10001,0b10001,0b11110,0b10001,0b10001,0b11110],
  C: [0b01110,0b10001,0b10000,0b10000,0b10000,0b10001,0b01110],
  D: [0b11110,0b10001,0b10001,0b10001,0b10001,0b10001,0b11110],
  E: [0b11111,0b10000,0b10000,0b11110,0b10000,0b10000,0b11111],
  F: [0b11111,0b10000,0b10000,0b11110,0b10000,0b10000,0b10000],
  G: [0b01110,0b10001,0b10000,0b10111,0b10001,0b10001,0b01111],
  H: [0b10001,0b10001,0b10001,0b11111,0b10001,0b10001,0b10001],
  I: [0b01110,0b00100,0b00100,0b00100,0b00100,0b00100,0b01110],
  J: [0b00111,0b00010,0b00010,0b00010,0b00010,0b10010,0b01100],
  K: [0b10001,0b10010,0b10100,0b11000,0b10100,0b10010,0b10001],
  L: [0b10000,0b10000,0b10000,0b10000,0b10000,0b10000,0b11111],
  M: [0b10001,0b11011,0b10101,0b10101,0b10001,0b10001,0b10001],
  N: [0b10001,0b11001,0b10101,0b10011,0b10001,0b10001,0b10001],
  O: [0b01110,0b10001,0b10001,0b10001,0b10001,0b10001,0b01110],
  P: [0b11110,0b10001,0b10001,0b11110,0b10000,0b10000,0b10000],
  Q: [0b01110,0b10001,0b10001,0b10001,0b10101,0b10010,0b01101],
  R: [0b11110,0b10001,0b10001,0b11110,0b10100,0b10010,0b10001],
  S: [0b01111,0b10000,0b10000,0b01110,0b00001,0b00001,0b11110],
  T: [0b11111,0b00100,0b00100,0b00100,0b00100,0b00100,0b00100],
  U: [0b10001,0b10001,0b10001,0b10001,0b10001,0b10001,0b01110],
  V: [0b10001,0b10001,0b10001,0b10001,0b10001,0b01010,0b00100],
  W: [0b10001,0b10001,0b10001,0b10101,0b10101,0b11011,0b10001],
  X: [0b10001,0b10001,0b01010,0b00100,0b01010,0b10001,0b10001],
  Y: [0b10001,0b10001,0b01010,0b00100,0b00100,0b00100,0b00100],
  Z: [0b11111,0b00001,0b00010,0b00100,0b01000,0b10000,0b11111],
  ' ': [0,0,0,0,0,0,0],
  '.': [0,0,0,0,0,0b00100,0b00100],
  '-': [0,0,0,0b11111,0,0,0],
};

// 在超采样画布上绘制文字（返回文字总宽度）
function drawText(rgba, W, text, x, y, scale, color) {
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch] || FONT[' '];
    for (let row = 0; row < 7; row++) {
      const bits = glyph[row];
      for (let col = 0; col < 5; col++) {
        if (bits & (1 << (4 - col))) {
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              const px = cx + col * scale + dx;
              const py = y + row * scale + dy;
              if (px >= 0 && px < W && py >= 0) {
                const idx = (py * W + px) * 4;
                rgba[idx] = color[0]; rgba[idx+1] = color[1]; rgba[idx+2] = color[2]; rgba[idx+3] = 255;
              }
            }
          }
        }
      }
    }
    cx += 6 * scale;
  }
  return cx;
}

// ---------- 双线性降采样 ----------
function downsample(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  for (let dy = 0; dy < dh; dy++) {
    const sy = (dy + 0.5) * sh / dh - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const fy = sy - y0;
    for (let dx = 0; dx < dw; dx++) {
      const sx = (dx + 0.5) * sw / dw - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(sw - 1, x0 + 1);
      const fx = sx - x0;
      const oi = (dy * dw + dx) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = src[(y0 * sw + x0) * 4 + c];
        const p10 = src[(y0 * sw + x1) * 4 + c];
        const p01 = src[(y1 * sw + x0) * 4 + c];
        const p11 = src[(y1 * sw + x1) * 4 + c];
        const top = p00 * (1 - fx) + p10 * fx;
        const bot = p01 * (1 - fx) + p11 * fx;
        out[oi + c] = Math.round(top * (1 - fy) + bot * fy);
      }
    }
  }
  return out;
}

// ---------- 主流程 ----------
const W = 1200, H = 630;
const SS = 3; // 超采样倍数
const SW = W * SS, SH = H * SS;
const BG = [249, 248, 246];   // #F9F8F6
const INK = [26, 26, 26];     // #1A1A1A
const GOLD = [212, 175, 55];  // #D4AF37
const GRAY = [120, 118, 114];

// 超采样画布
const rgba = Buffer.alloc(SW * SH * 4);
for (let i = 0; i < SW * SH; i++) {
  rgba[i*4] = BG[0]; rgba[i*4+1] = BG[1]; rgba[i*4+2] = BG[2]; rgba[i*4+3] = 255;
}

// 顶部/底部金色细线
function hline(y, color) {
  for (let x = 0; x < SW; x++) {
    const idx = (y * SW + x) * 4;
    rgba[idx] = color[0]; rgba[idx+1] = color[1]; rgba[idx+2] = color[2]; rgba[idx+3] = 255;
  }
}
for (let y = 0; y < 6 * SS; y++) hline(y, GOLD);
for (let y = SH - 6 * SS; y < SH; y++) hline(y, GOLD);

// 放置 Logo（居中，保留比例，正方形）
const logo = decodePNG('assets/logo.png');
const logoSize = 210 * SS;
const lx = Math.floor((SW - logoSize) / 2);
const ly = 108 * SS;
for (let dy = 0; dy < logoSize; dy++) {
  for (let dx = 0; dx < logoSize; dx++) {
    const sx = Math.floor(dx * logo.width / logoSize);
    const sy = Math.floor(dy * logo.height / logoSize);
    const si = (sy * logo.width + sx) * logo.channels;
    const a = logo.channels === 4 ? logo.data[si + 3] : 255;
    if (a < 10) continue;
    const px = lx + dx, py = ly + dy;
    if (px < 0 || px >= SW || py < 0 || py >= SH) continue;
    const di = (py * SW + px) * 4;
    const alpha = a / 255;
    rgba[di] = Math.round(logo.data[si] * alpha + BG[0] * (1 - alpha));
    rgba[di+1] = Math.round(logo.data[si+1] * alpha + BG[1] * (1 - alpha));
    rgba[di+2] = Math.round(logo.data[si+2] * alpha + BG[2] * (1 - alpha));
    rgba[di+3] = 255;
  }
}

// 品牌名 "SoulMirror"（超采样后平滑）
const brandText = 'SoulMirror';
const scale = 8 * SS;
const charW = 6 * scale;
const totalW = brandText.length * charW;
const bx = Math.floor((SW - totalW) / 2);
const by = 372 * SS;
drawText(rgba, SW, brandText, bx, by, scale, INK);

// 金色分隔线
const lineW = 120 * SS;
const lineY = 492 * SS;
for (let x = Math.floor((SW - lineW) / 2); x < Math.floor((SW + lineW) / 2); x++) {
  const idx = (lineY * SW + x) * 4;
  rgba[idx] = GOLD[0]; rgba[idx+1] = GOLD[1]; rgba[idx+2] = GOLD[2]; rgba[idx+3] = 255;
}

// 描述（英文，小号）
const descText = 'Explore your soulmate';
const dscale = 4 * SS;
const dcharW = 6 * dscale;
const dtotalW = descText.length * dcharW;
const dx = Math.floor((SW - dtotalW) / 2);
drawText(rgba, SW, descText, dx, 532 * SS, dscale, GRAY);

// 降采样到 1200x630
const final = downsample(rgba, SW, SH, W, H);

fs.mkdirSync('assets', { recursive: true });
const out = encodePNG(W, H, final);
fs.writeFileSync('assets/share-cover.png', out);
fs.writeFileSync('make_cover_log.txt', 'OK saved assets/share-cover.png ' + W + 'x' + H + ' bytes=' + out.length);
console.log('saved');
