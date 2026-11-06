/**
 * qr-code.js —— 站内自包含二维码编码器（原生 JS，无依赖、无构建）
 *
 * 用途：各页面生成分享图时，按当前场景动态生成二维码，替代写死的固定码。
 * 用法：
 *   SMQR.encode('https://example.com/quiz?slug=xxx')       -> { size, version, modules }
 *   SMQR.draw(ctx, text, x, y, size, opts)                 -> 直接在 canvas 上绘制（白底黑码 + 静区）
 *   SMQR.toDataURL(text, size, opts)                       -> data URL（可选）
 *
 * 说明：
 * - 字节模式（UTF-8）+ 纠错等级 M，自动选择版本 1–10，8 种掩码按罚分择优。
 * - 绘制时按整数像素落格，避免缩放糊掉；默认静区 4 模块。
 */
(function (global) {
  'use strict';

  /* ---------- GF(256) ---------- */
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i += 1) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j += 1) EXP[j] = EXP[j - 255];
  })();

  function gfMul(a, b) {
    if (!a || !b) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function polyMul(a, b) {
    var out = new Uint8Array(a.length + b.length - 1);
    for (var i = 0; i < a.length; i += 1) {
      for (var j = 0; j < b.length; j += 1) {
        out[i + j] ^= gfMul(a[i], b[j]);
      }
    }
    return out;
  }

  function genPoly(len) {
    var g = new Uint8Array([1]);
    for (var i = 0; i < len; i += 1) g = polyMul(g, new Uint8Array([1, EXP[i]]));
    return g;
  }

  function rsRemainder(data, ecLen) {
    var gen = genPoly(ecLen);
    var rem = new Uint8Array(ecLen);
    for (var i = 0; i < data.length; i += 1) {
      var factor = data[i] ^ rem[0];
      rem[0] = rem[1]; // shift 在下面循环统一处理
      for (var k = 1; k < ecLen - 1; k += 1) rem[k] = rem[k + 1];
      rem[ecLen - 1] = 0;
      if (factor) {
        for (var j = 0; j < ecLen; j += 1) rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
    return rem;
  }

  /* ---------- 版本参数（纠错等级 M，版本 1–10） ---------- */
  var EC_M = {
    1: { ec: 10, blocks: [[1, 16]] },
    2: { ec: 16, blocks: [[1, 28]] },
    3: { ec: 26, blocks: [[1, 44]] },
    4: { ec: 18, blocks: [[2, 32]] },
    5: { ec: 24, blocks: [[2, 43]] },
    6: { ec: 16, blocks: [[4, 27]] },
    7: { ec: 18, blocks: [[4, 31]] },
    8: { ec: 22, blocks: [[2, 38], [2, 39]] },
    9: { ec: 22, blocks: [[3, 36], [2, 37]] },
    10: { ec: 26, blocks: [[4, 43], [1, 44]] }
  };

  var ALIGN = {
    1: [],
    2: [6, 18],
    3: [6, 22],
    4: [6, 26],
    5: [6, 30],
    6: [6, 34],
    7: [6, 22, 38],
    8: [6, 24, 42],
    9: [6, 26, 46],
    10: [6, 28, 50]
  };

  function dataCodewords(version) {
    var spec = EC_M[version];
    var n = 0;
    spec.blocks.forEach(function (b) { n += b[0] * b[1]; });
    return n;
  }

  /* ---------- UTF-8 ---------- */
  function utf8Bytes(str) {
    var s = String(str);
    var out = [];
    for (var i = 0; i < s.length; i += 1) {
      var c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        var c2 = s.charCodeAt(i + 1);
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        i += 1;
      } else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
    }
    return out;
  }

  /* ---------- 数据编码 ---------- */
  function pickVersion(byteLen) {
    for (var v = 1; v <= 10; v += 1) {
      var countBits = v <= 9 ? 8 : 16;
      var need = 4 + countBits + byteLen * 8;
      if (need <= dataCodewords(v) * 8) return v;
    }
    return 0;
  }

  function encodeData(text, version) {
    var bytes = utf8Bytes(text);
    var capacity = dataCodewords(version) * 8;
    var bits = [];
    function push(val, len) {
      for (var i = len - 1; i >= 0; i -= 1) bits.push((val >> i) & 1);
    }
    push(4, 4);
    push(bytes.length, version <= 9 ? 8 : 16);
    bytes.forEach(function (b) { push(b, 8); });
    push(0, Math.min(4, capacity - bits.length));
    while (bits.length % 8) bits.push(0);
    var pad = [0xec, 0x11];
    var p = 0;
    while (bits.length < capacity) { push(pad[p % 2], 8); p += 1; }
    var out = [];
    for (var i = 0; i < bits.length; i += 8) {
      var v = 0;
      for (var j = 0; j < 8; j += 1) v = (v << 1) | bits[i + j];
      out.push(v);
    }
    return out;
  }

  function buildCodewords(data, version) {
    var spec = EC_M[version];
    var offset = 0;
    var dataBlocks = [];
    var ecBlocks = [];
    spec.blocks.forEach(function (b) {
      for (var i = 0; i < b[0]; i += 1) {
        var chunk = data.slice(offset, offset + b[1]);
        offset += b[1];
        dataBlocks.push(chunk);
        ecBlocks.push(rsRemainder(chunk, spec.ec));
      }
    });
    var maxLen = 0;
    dataBlocks.forEach(function (b) { if (b.length > maxLen) maxLen = b.length; });
    var out = [];
    for (var i = 0; i < maxLen; i += 1) {
      for (var j = 0; j < dataBlocks.length; j += 1) if (i < dataBlocks[j].length) out.push(dataBlocks[j][i]);
    }
    for (var k = 0; k < spec.ec; k += 1) {
      for (var m = 0; m < ecBlocks.length; m += 1) out.push(ecBlocks[m][k]);
    }
    return out;
  }

  /* ---------- 矩阵 ---------- */
  function makeMatrix(version) {
    var size = version * 4 + 17;
    var modules = [];
    var func = [];
    for (var y = 0; y < size; y += 1) {
      modules.push(new Uint8Array(size));
      func.push(new Uint8Array(size));
    }

    function setFn(x, y, dark) {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      modules[y][x] = dark ? 1 : 0;
      func[y][x] = 1;
    }

    // 定位图案（含分隔带）
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (p) {
      var cx = p[0], cy = p[1];
      for (var dy = -4; dy <= 4; dy += 1) {
        for (var dx = -4; dx <= 4; dx += 1) {
          var ax = Math.abs(dx), ay = Math.abs(dy);
          var dark = false;
          if (ax <= 3 && ay <= 3) dark = (ax === 3 || ay === 3 || (ax <= 1 && ay <= 1));
          setFn(cx + dx, cy + dy, dark);
        }
      }
    });

    // 时序线
    for (var i = 8; i < size - 8; i += 1) {
      setFn(i, 6, i % 2 === 0);
      setFn(6, i, i % 2 === 0);
    }

    // 对齐图案
    var centers = ALIGN[version];
    centers.forEach(function (cx) {
      centers.forEach(function (cy) {
        if ((cx === 6 && cy === 6) || (cx === 6 && cy === size - 7) || (cx === size - 7 && cy === 6)) return;
        for (var dy = -2; dy <= 2; dy += 1) {
          for (var dx = -2; dx <= 2; dx += 1) {
            var ax = Math.abs(dx), ay = Math.abs(dy);
            setFn(cx + dx, cy + dy, ax === 2 || ay === 2 || (ax === 0 && ay === 0));
          }
        }
      });
    });

    // 固定深色模块 + 预留格式信息区
    setFn(8, size - 8, true);

    // 格式信息：先用占位标记为功能区，真正取值在 drawFormat 时写入
    for (var k = 0; k <= 5; k += 1) setFn(8, k, false);
    setFn(8, 7, false);
    setFn(8, 8, false);
    setFn(7, 8, false);
    for (var k2 = 9; k2 < 15; k2 += 1) setFn(14 - k2, 8, false);
    for (var k3 = 0; k3 < 8; k3 += 1) setFn(size - 1 - k3, 8, false);
    for (var k4 = 8; k4 < 15; k4 += 1) setFn(8, size - 15 + k4, false);

    // 版本信息（版本 ≥ 7）
    if (version >= 7) {
      for (var v = 0; v < 18; v += 1) {
        var a = size - 11 + (v % 3);
        var b = Math.floor(v / 3);
        setFn(a, b, false);
        setFn(b, a, false);
      }
    }

    return { size: size, modules: modules, func: func, version: version };
  }

  function bch15(data) {
    var rem = data << 10;
    for (var i = 14; i >= 10; i -= 1) {
      if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
    }
    return ((data << 10) | rem) ^ 0x5412;
  }

  function bch18(data) {
    var rem = data << 12;
    for (var i = 17; i >= 12; i -= 1) {
      if ((rem >> i) & 1) rem ^= 0x1f25 << (i - 12);
    }
    return (data << 12) | rem;
  }

  function drawFormat(m, mask) {
    // 纠错等级 M 指示位 = 00
    var bits = bch15((0 << 3) | mask);
    var size = m.size;
    function get(i) { return (bits >> i) & 1; }
    function put(x, y, i) { m.modules[y][x] = get(i); }
    // 第一份
    for (var i = 0; i <= 5; i += 1) put(8, i, i);
    put(8, 7, 6);
    put(8, 8, 7);
    put(7, 8, 8);
    for (var k = 9; k < 15; k += 1) put(14 - k, 8, k);
    // 第二份
    for (var j = 0; j < 8; j += 1) put(size - 1 - j, 8, j);
    for (var k2 = 8; k2 < 15; k2 += 1) put(8, size - 15 + k2, k2);
    // 固定深色模块
    m.modules[size - 8][8] = 1;
  }

  function drawVersion(m) {
    if (m.version < 7) return;
    var bits = bch18(m.version);
    for (var i = 0; i < 18; i += 1) {
      var bit = (bits >> i) & 1;
      var a = m.size - 11 + (i % 3);
      var b = Math.floor(i / 3);
      m.modules[b][a] = bit;
      m.modules[a][b] = bit;
    }
  }

  function placeData(m, codewords) {
    var size = m.size;
    var totalBits = codewords.length * 8;
    var bitIndex = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert += 1) {
        for (var j = 0; j < 2; j += 1) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? size - 1 - vert : vert;
          if (!m.func[y][x] && bitIndex < totalBits) {
            m.modules[y][x] = (codewords[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
            bitIndex += 1;
          }
        }
      }
    }
  }

  function maskFn(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  }

  function applyMask(m, mask) {
    for (var y = 0; y < m.size; y += 1) {
      for (var x = 0; x < m.size; x += 1) {
        if (!m.func[y][x] && maskFn(mask, x, y)) m.modules[y][x] ^= 1;
      }
    }
  }

  function penalty(m) {
    var size = m.size;
    var score = 0;

    // 规则 1：连续同色 ≥5
    function runScore(line) {
      var s = 0;
      var run = 1;
      for (var i = 1; i <= size; i += 1) {
        if (i < size && line[i] === line[i - 1]) { run += 1; }
        else { if (run >= 5) s += 3 + (run - 5); run = 1; }
      }
      return s;
    }
    for (var y = 0; y < size; y += 1) {
      var row = [];
      var col = [];
      for (var x = 0; x < size; x += 1) { row.push(m.modules[y][x]); col.push(m.modules[x][y]); }
      score += runScore(row) + runScore(col);
    }

    // 规则 2：2×2 同色
    for (var yy = 0; yy < size - 1; yy += 1) {
      for (var xx = 0; xx < size - 1; xx += 1) {
        var c = m.modules[yy][xx];
        if (c === m.modules[yy][xx + 1] && c === m.modules[yy + 1][xx] && c === m.modules[yy + 1][xx + 1]) score += 3;
      }
    }

    // 规则 3：1:1:3:1:1 近似定位图案
    var pat = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    var patRev = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    function matchPat(line, p) {
      var hits = 0;
      for (var i = 0; i + p.length <= line.length; i += 1) {
        var ok = true;
        for (var j = 0; j < p.length; j += 1) {
          if (line[i + j] !== p[j]) { ok = false; break; }
        }
        if (ok) hits += 1;
      }
      return hits * 40;
    }
    for (var y2 = 0; y2 < size; y2 += 1) {
      var row2 = [], col2 = [];
      for (var x2 = 0; x2 < size; x2 += 1) { row2.push(m.modules[y2][x2]); col2.push(m.modules[x2][y2]); }
      score += matchPat(row2, pat) + matchPat(row2, patRev) + matchPat(col2, pat) + matchPat(col2, patRev);
    }

    // 规则 4：深色占比
    var dark = 0;
    for (var y3 = 0; y3 < size; y3 += 1) {
      for (var x3 = 0; x3 < size; x3 += 1) dark += m.modules[y3][x3];
    }
    var ratio = Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size));
    score += ratio * 10;

    return score;
  }

  function encode(text) {
    var bytes = utf8Bytes(text);
    var version = pickVersion(bytes.length);
    if (!version) throw new Error('SMQR: 文本过长，超出 10 版本 M 级容量');
    var codewords = buildCodewords(encodeData(text, version), version);
    var base = makeMatrix(version);
    placeData(base, codewords);

    var best = null;
    var bestScore = Infinity;
    for (var mask = 0; mask < 8; mask += 1) {
      var m = {
        size: base.size,
        version: base.version,
        modules: base.modules.map(function (row) { return row.slice(); }),
        func: base.func
      };
      applyMask(m, mask);
      drawFormat(m, mask);
      drawVersion(m);
      var score = penalty(m);
      if (score < bestScore) {
        bestScore = score;
        best = {
          size: m.size,
          version: version,
          modules: m.modules,
          mask: mask
        };
      }
    }

    return { size: best.size, version: version, modules: best.modules, mask: best.mask };
  }

  /* ---------- 绘制 ---------- */
  function draw(ctx, text, x, y, size, opts) {
    opts = opts || {};
    var margin = opts.margin === undefined ? 4 : opts.margin;
    var qr = encode(text);
    var total = qr.size + margin * 2;
    var cell = Math.floor(size / total);
    if (cell < 1) cell = 1;
    var drawn = cell * total;
    var ox = Math.floor(x + (size - drawn) / 2);
    var oy = Math.floor(y + (size - drawn) / 2);

    ctx.fillStyle = opts.light || '#ffffff';
    ctx.fillRect(ox, oy, drawn, drawn);

    ctx.fillStyle = opts.dark || '#101010';
    for (var r = 0; r < qr.size; r += 1) {
      for (var c = 0; c < qr.size; c += 1) {
        if (qr.modules[r][c]) ctx.fillRect(ox + (margin + c) * cell, oy + (margin + r) * cell, cell, cell);
      }
    }
    return { x: ox, y: oy, size: drawn, cell: cell, version: qr.version };
  }

  function toDataURL(text, size, opts) {
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    draw(ctx, text, 0, 0, size, opts);
    return canvas.toDataURL('image/png');
  }

  global.SMQR = { encode: encode, draw: draw, toDataURL: toDataURL };
})(window);
