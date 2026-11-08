/* 记把好账 · 本地账单导入
 * 支持微信 / 支付宝导出的 CSV、XLSX（以及 Excel 2003 XML .xls）。
 * 全程在浏览器内解析，不上传任何数据；PDF 需要额外 OCR 引擎，当前版本明确拒绝。
 */
(function (global) {
  'use strict';

  const QH = global.QH = global.QH || {};
  const U = global.QHUtil;
  const Store = global.QHStore;

  const KEYWORDS = {
    breakfast: ['早餐', '早饭', '豆浆', '包子', '油条', '粥', '面包', '咖啡'],
    lunch: ['午餐', '午饭', '快餐', '便当', '沙拉', '米饭', '面馆', '食堂'],
    dinner: ['晚餐', '晚饭', '火锅', '烧烤', '聚餐', '夜宵', '外卖'],
    bath: ['洗澡', '洗浴', '淋浴', '澡堂', '浴池', '汗蒸'],
    water: ['饮水', '矿泉水', '桶装水', '纯净水', '买水'],
    transport: ['地铁', '公交', '打车', '滴滴', '出租车', '高铁', '火车', '加油', '停车', '单车'],
    shopping: ['淘宝', '天猫', '京东', '拼多多', '超市', '商场', '购物', '便利店'],
    entertainment: ['电影', '游戏', 'KTV', '娱乐', '会员', '视频', '音乐'],
    daily: ['日用', '纸巾', '洗衣', '日用品', '清洁', '家居'],
    housing: ['房租', '物业', '水费', '电费', '燃气', '宽带']
  };

  function decodeText(buffer) {
    const bytes = new Uint8Array(buffer);
    // UTF-8 BOM
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      return new TextDecoder('utf-8').decode(bytes.subarray(3));
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      try {
        return new TextDecoder('gb18030').decode(bytes);
      } catch (e2) {
        return new TextDecoder('utf-8').decode(bytes);
      }
    }
  }

  /* ---------------- CSV ---------------- */
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const s = text.replace(/\r\n?/g, '\n');
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quoted) {
        if (ch === '"') {
          if (s[i + 1] === '"') { cell += '"'; i++; }
          else quoted = false;
        } else cell += ch;
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ',') {
        row.push(cell); cell = '';
      } else if (ch === '\n') {
        row.push(cell); cell = '';
        if (row.some(function (c) { return String(c).trim() !== ''; })) rows.push(row);
        row = [];
      } else if (ch !== '\r') {
        cell += ch;
      }
    }
    if (cell !== '' || row.length) {
      row.push(cell);
      if (row.some(function (c) { return String(c).trim() !== ''; })) rows.push(row);
    }
    return rows;
  }

  /* ---------------- ZIP / XLSX ---------------- */
  function u16(dv, off) { return dv.getUint16(off, true); }
  function u32(dv, off) { return dv.getUint32(off, true); }

  async function inflateRaw(bytes) {
    if (!bytes || !bytes.length) return '';
    if (typeof DecompressionStream === 'undefined') throw new Error('当前环境不支持解压 XLSX，请改用 CSV');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  }

  async function readZip(buffer) {
    const bytes = new Uint8Array(buffer);
    const dv = new DataView(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
      if (u32(dv, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 XLSX 文件');
    const count = u16(dv, eocd + 10);
    let off = u32(dv, eocd + 16);
    const files = {};
    for (let n = 0; n < count; n++) {
      if (u32(dv, off) !== 0x02014b50) break;
      const method = u16(dv, off + 10);
      const compSize = u32(dv, off + 20);
      const nameLen = u16(dv, off + 28);
      const extraLen = u16(dv, off + 30);
      const commentLen = u16(dv, off + 32);
      const localOff = u32(dv, off + 42);
      const name = new TextDecoder('utf-8').decode(bytes.subarray(off + 46, off + 46 + nameLen));
      const lNameLen = u16(dv, localOff + 26);
      const lExtraLen = u16(dv, localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const raw = bytes.subarray(dataStart, dataStart + compSize);
      files[name] = { method: method, raw: raw };
      off += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  function colIndex(ref) {
    const m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return 0;
    let n = 0;
    for (let i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64);
    return n - 1;
  }

  function xmlText(s) {
    return String(s || '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
      .replace(/&amp;/g, '&');
  }

  function cellText(xml) {
    const t = /<t[^>]*>([\s\S]*?)<\/t>/.exec(xml);
    if (t) return xmlText(t[1]);
    const v = /<v[^>]*>([\s\S]*?)<\/v>/.exec(xml);
    return v ? xmlText(v[1]) : '';
  }

  async function parseXlsx(buffer) {
    const files = await readZip(buffer);
    const shared = [];
    if (files['xl/sharedStrings.xml']) {
      const xml = await inflateRaw(files['xl/sharedStrings.xml'].raw);
      const items = xml.match(/<si>[\s\S]*?<\/si>/g) || [];
      items.forEach(function (si) {
        const ts = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
        shared.push(ts.map(function (x) { return cellText(x); }).join(''));
      });
    }
    let sheetPath = 'xl/worksheets/sheet1.xml';
    if (files['xl/workbook.xml'] && files['xl/_rels/workbook.xml.rels']) {
      const wb = await inflateRaw(files['xl/workbook.xml'].raw);
      const rels = await inflateRaw(files['xl/_rels/workbook.xml.rels'].raw);
      const first = /<sheet[^>]*r:id="([^"]+)"/.exec(wb);
      if (first) {
        const rel = new RegExp('<Relationship[^>]*Id="' + first[1] + '"[^>]*Target="([^"]+)"').exec(rels);
        if (rel) sheetPath = 'xl/' + rel[1].replace(/^\.?\//, '').replace(/^xl\//, '');
      }
    }
    if (!files[sheetPath]) {
      const key = Object.keys(files).find(function (k) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(k); });
      if (key) sheetPath = key;
    }
    if (!files[sheetPath]) throw new Error('XLSX 中找不到工作表');
    const sheet = await inflateRaw(files[sheetPath].raw);
    const rows = [];
    const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
    let rm;
    while ((rm = rowRe.exec(sheet))) {
      const cells = [];
      const cellRe = /<c([^>]*)>([\s\S]*?)<\/c>/g;
      let cm;
      while ((cm = cellRe.exec(rm[1]))) {
        const attrs = cm[1];
        const ref = (/r="([^"]+)"/.exec(attrs) || [])[1] || '';
        const type = (/t="([^"]+)"/.exec(attrs) || [])[1] || '';
        let value = cellText(cm[2]);
        if (type === 's') value = shared[Number(value)] || '';
        const idx = colIndex(ref);
        cells[idx] = value;
      }
      rows.push(cells);
    }
    return rows;
  }

  async function parseXlsXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const rows = [];
    Array.prototype.forEach.call(doc.getElementsByTagName('Row'), function (row) {
      const cells = [];
      Array.prototype.forEach.call(row.getElementsByTagName('Cell'), function (cell, i) {
        const data = cell.getElementsByTagName('Data')[0];
        const idx = Number(cell.getAttribute('ss:Index') || (i + 1)) - 1;
        cells[idx] = data ? data.textContent : '';
      });
      rows.push(cells);
    });
    return rows;
  }

  /* ---------------- 字段识别 ---------------- */
  function findHeader(rows) {
    for (let i = 0; i < Math.min(rows.length, 40); i++) {
      const joined = rows[i].join('|');
      if (/金额|amount/i.test(joined) && /(交易时间|时间|日期|date)/i.test(joined)) return i;
    }
    return -1;
  }

  function findCol(header, re) {
    for (let i = 0; i < header.length; i++) {
      if (re.test(String(header[i]).trim())) return i;
    }
    return -1;
  }

  function parseDate(raw) {
    const s = String(raw || '').trim();
    const m = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(s);
    if (!m) return null;
    const y = m[1], mo = String(m[2]).padStart(2, '0'), d = String(m[3]).padStart(2, '0');
    let time = '12:00';
    const tm = /(\d{1,2}):(\d{2})/.exec(s);
    if (tm) time = String(tm[1]).padStart(2, '0') + ':' + tm[2];
    return { date: y + '-' + mo + '-' + d, time: time };
  }

  function parseAmount(raw) {
    let s = String(raw == null ? '' : raw).replace(/[¥￥,\s]/g, '').replace(/元$/, '');
    if (!s || s === '-') return null;
    const neg = /^-/.test(s);
    s = s.replace(/^-/, '');
    const n = Number(s);
    if (!isFinite(n)) return null;
    return { amount: Math.round(n * 100) / 100, negative: neg };
  }

  function guessCategory(text) {
    const t = String(text || '');
    const order = ['bath', 'water', 'breakfast', 'lunch', 'dinner', 'transport', 'shopping', 'entertainment', 'daily', 'housing'];
    for (let i = 0; i < order.length; i++) {
      const id = order[i];
      if (KEYWORDS[id].some(function (k) { return t.indexOf(k) >= 0; })) return id;
    }
    return 'other';
  }

  function rowsToItems(rows) {
    const hi = findHeader(rows);
    if (hi < 0) return { items: [], total: 0, warnings: ['没有识别到表头（需要包含“交易时间/金额”等列）'] };
    const header = rows[hi];
    const cDate = findCol(header, /交易时间|时间|日期|date/i);
    const cAmount = findCol(header, /金额|amount/i);
    let cDir = findCol(header, /收\/支|收支/);
    if (cDir < 0) cDir = findCol(header, /交易类型|类型|direction/i);
    const cMerchant = findCol(header, /交易对方|对方|商户|merchant|收款方/i);
    const cProduct = findCol(header, /商品|说明|摘要|备注|product|memo/i);
    const cStatus = findCol(header, /状态|status/i);
    const cCat = findCol(header, /交易分类|分类|category/i);

    const items = [];
    const warnings = [];
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r.length) continue;
      const dirText = String(r[cDir] || '');
      if (/不计收支|转账|还款|理财/.test(dirText) && !/收入|支出/.test(dirText)) { warnings.push('第 ' + (i + 1) + ' 行：' + dirText + '，已跳过'); continue; }
      if (/失败|关闭|已撤销/.test(String(r[cStatus] || ''))) continue;
      const d = parseDate(r[cDate]);
      const a = parseAmount(r[cAmount]);
      if (!d || !a || !(a.amount > 0)) { if (r.join('').trim()) warnings.push('跳过 ' + (i + 1) + ' 行：缺少日期或金额'); continue; }
      let type = 'expense';
      if (/收入|收/.test(dirText)) type = 'income';
      if (a.negative) type = 'income';
      const merchant = String(r[cMerchant] || '').trim();
      const product = String(r[cProduct] || '').trim();
      const catText = String(r[cCat] || '');
      const note = [merchant, product].filter(Boolean).join(' · ').slice(0, 60) || '导入账单';
      const category = type === 'income' ? 'income' : (guessCategory(catText + ' ' + note) || 'other');
      const tx = {
        type: type,
        amount: a.amount,
        category: category,
        note: note,
        date: d.date,
        time: d.time
      };
      tx.duplicate = QH.Store.hasDuplicate(tx);
      items.push(tx);
    }
    return { items: items, total: items.length, warnings: warnings };
  }

  async function parseFile(file) {
    const name = String(file.name || '').toLowerCase();
    if (/\.pdf$/.test(name)) throw new Error('PDF 需要 OCR 引擎，当前版本请导入 CSV 或 XLSX');
    const buffer = await file.arrayBuffer();
    let rows;
    if (/\.csv$/.test(name)) {
      rows = parseCSV(decodeText(buffer));
    } else if (/\.xlsx$/.test(name)) {
      rows = await parseXlsx(buffer);
    } else if (/\.xls$/.test(name)) {
      const text = decodeText(buffer);
      if (/<Workbook/i.test(text)) rows = await parseXlsXml(text);
      else throw new Error('旧版 .xls 二进制格式暂不支持，请另存为 .xlsx 或 .csv');
    } else {
      throw new Error('仅支持 .csv / .xlsx / .xls（Excel XML）');
    }
    const result = rowsToItems(rows);
    result.source = file.name;
    return result;
  }

  QH.Import = {
    parseFile: parseFile,
    parseCSV: parseCSV,
    guessCategory: guessCategory
  };
})(window);
