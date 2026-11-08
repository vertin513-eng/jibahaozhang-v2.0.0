/*!
 * 记把好账 · 基础工具
 * 日期、金额、下载、格式化等无依赖工具函数。
 */
(function (global) {
  'use strict';
  const QH = (global.QH = global.QH || {});
  const U = {};

  /* ---------------- 日期 ---------------- */

  const pad2 = (n) => String(n).padStart(2, '0');
  const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const WEEK_SHORT = ['日', '一', '二', '三', '四', '五', '六'];

  U.pad2 = pad2;

  /** Date -> 'YYYY-MM-DD'（使用本地时间） */
  U.ymd = function (date) {
    const d = date instanceof Date ? date : new Date(date);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  };

  U.hm = function (date) {
    const d = date instanceof Date ? date : new Date(date);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  };

  /** 'YYYY-MM-DD' -> Date（落在中午，规避 DST 边界问题） */
  U.parseYmd = function (s) {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  };

  U.isYmd = function (s) {
    return !!U.parseYmd(s);
  };

  U.today = function () {
    return U.ymd(new Date());
  };

  U.addDays = function (dateOrYmd, n) {
    const d = typeof dateOrYmd === 'string' ? U.parseYmd(dateOrYmd) : new Date(dateOrYmd);
    d.setDate(d.getDate() + n);
    return typeof dateOrYmd === 'string' ? U.ymd(d) : d;
  };

  U.addMonths = function (dateOrYmd, n) {
    const d = typeof dateOrYmd === 'string' ? U.parseYmd(dateOrYmd) : new Date(dateOrYmd);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    d.setDate(Math.min(day, U.daysInMonth(d.getFullYear(), d.getMonth())));
    return typeof dateOrYmd === 'string' ? U.ymd(d) : d;
  };

  U.daysInMonth = function (year, month /* 0-11 */) {
    return new Date(year, month + 1, 0).getDate();
  };

  U.startOfMonth = function (dateOrYmd) {
    const d = typeof dateOrYmd === 'string' ? U.parseYmd(dateOrYmd) : new Date(dateOrYmd);
    return new Date(d.getFullYear(), d.getMonth(), 1, 12);
  };

  /** 周一为一周起点 */
  U.startOfWeek = function (dateOrYmd) {
    const d = typeof dateOrYmd === 'string' ? U.parseYmd(dateOrYmd) : new Date(dateOrYmd);
    const offset = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - offset);
    return d;
  };

  U.endOfWeek = function (dateOrYmd) {
    return U.addDays(U.startOfWeek(dateOrYmd), 6);
  };

  U.diffDays = function (a, b) {
    const da = U.parseYmd(a);
    const db = U.parseYmd(b);
    return Math.round((da - db) / 86400000);
  };

  U.weekdayCN = function (dateOrYmd) {
    const d = typeof dateOrYmd === 'string' ? U.parseYmd(dateOrYmd) : dateOrYmd;
    return WEEK_CN[d.getDay()];
  };

  U.weekdayShort = function (i) {
    // i: 0 = 周一 ... 6 = 周日
    return ['一', '二', '三', '四', '五', '六', '日'][i];
  };

  U.monthLabel = function (dateOrYmd) {
    const d = typeof dateOrYmd === 'string' ? U.parseYmd(dateOrYmd) : dateOrYmd;
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月';
  };

  U.monthDayLabel = function (ymd) {
    const d = U.parseYmd(ymd);
    return d.getMonth() + 1 + '月' + d.getDate() + '日';
  };

  U.fullDateLabel = function (ymd) {
    const d = U.parseYmd(ymd);
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  };

  U.relativeDay = function (ymd) {
    const diff = U.diffDays(U.today(), ymd);
    if (diff === 0) return '今天';
    if (diff === 1) return '昨天';
    if (diff === 2) return '前天';
    if (diff === -1) return '明天';
    return U.monthDayLabel(ymd);
  };

  U.greeting = function (date) {
    const h = (date || new Date()).getHours();
    if (h < 6) return '夜深了';
    if (h < 11) return '早上好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  };

  /** 生成某月日历网格（6 行 × 7 列，周一起始），返回 YYYY-MM-DD 数组 */
  U.monthGrid = function (year, month) {
    const first = new Date(year, month, 1, 12);
    const start = U.startOfWeek(first);
    const out = [];
    for (let i = 0; i < 42; i++) out.push(U.ymd(U.addDays(start, i)));
    return out;
  };

  U.weekDays = function (dateOrYmd) {
    const start = U.startOfWeek(dateOrYmd);
    const out = [];
    for (let i = 0; i < 7; i++) out.push(U.ymd(U.addDays(start, i)));
    return out;
  };

  U.quarter = function (dateOrYmd) {
    const d = typeof dateOrYmd === 'string' ? U.parseYmd(dateOrYmd) : dateOrYmd;
    return Math.floor(d.getMonth() / 3) + 1;
  };

  U.daysBetween = function (from, to) {
    return U.diffDays(to, from) + 1;
  };

  /* ---------------- 金额 ---------------- */

  U.round2 = function (n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  };

  U.toNumber = function (v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const n = parseFloat(String(v == null ? '' : v).replace(/[^\d.-]/g, ''));
    return isFinite(n) ? n : 0;
  };

  /** 千分位，始终两位小数 */
  U.money = function (n, symbol) {
    const num = U.round2(U.toNumber(n));
    const parts = num.toFixed(2).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (symbol == null ? '¥' : symbol) + parts.join('.');
  };

  /** 千分位，整数时省略小数（用于按钮、快捷金额） */
  U.moneyShort = function (n, symbol) {
    const num = U.round2(U.toNumber(n));
    const isInt = Math.abs(num - Math.round(num)) < 0.005;
    const parts = (isInt ? String(Math.round(num)) : num.toFixed(2)).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (symbol == null ? '¥' : symbol) + parts.join('.');
  };

  /** 日历格子里的紧凑数字：1234 -> 1.2k；12000 -> 1.2万 */
  U.compact = function (n) {
    const num = Math.abs(U.toNumber(n));
    if (num >= 10000) return (num / 10000).toFixed(num >= 100000 ? 0 : 1).replace(/\.0$/, '') + '万';
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    if (num >= 100) return String(Math.round(num));
    if (num === 0) return '';
    return num % 1 === 0 ? String(num) : num.toFixed(0);
  };

  /** 图表轴标签：1200 -> 1.2k */
  U.axisShort = function (n) {
    const num = Math.abs(n);
    if (num >= 10000) return (num / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    if (num >= 1) return String(Math.round(num));
    return '0';
  };

  U.percent = function (part, total) {
    if (!total) return 0;
    return (part / total) * 100;
  };

  U.percentText = function (part, total, digits) {
    const p = U.percent(part, total);
    if (!isFinite(p)) return '0%';
    return (digits ? p.toFixed(digits) : Math.round(p)) + '%';
  };

  /* ---------------- 其它 ---------------- */

  U.uid = function () {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'tx_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  };

  U.escapeHTML = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  U.debounce = function (fn, wait) {
    let timer = null;
    return function () {
      const args = arguments;
      const ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(ctx, args);
      }, wait);
    };
  };

  U.clamp = function (n, min, max) {
    return Math.max(min, Math.min(max, n));
  };

  U.sum = function (arr, pick) {
    return arr.reduce(function (acc, item) {
      return acc + (pick ? U.toNumber(pick(item)) : U.toNumber(item));
    }, 0);
  };

  U.groupBy = function (arr, keyFn) {
    const map = new Map();
    arr.forEach(function (item) {
      const k = keyFn(item);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(item);
    });
    return map;
  };

  /** 下载 Blob（iOS Safari 也兼容；Android / Windows 桌面壳交给原生桥保存） */
  U.download = function (filename, blob) {
    const nativeShell = window.QHAndroid || window.QHDesktop;
    if (nativeShell && typeof nativeShell.saveFile === 'function' && typeof FileReader !== 'undefined') {
      try {
        const reader = new FileReader();
        reader.onload = function () {
          const data = String(reader.result || '');
          const comma = data.indexOf(',');
          if (comma > 0) {
            nativeShell.saveFile(filename, blob.type || 'application/octet-stream', data.slice(comma + 1));
          }
        };
        reader.readAsDataURL(blob);
        return;
      } catch (e) { /* 桥不可用时回退到浏览器下载 */ }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 800);
  };

  U.fileStamp = function () {
    const d = new Date();
    return U.ymd(d) + '_' + pad2(d.getHours()) + pad2(d.getMinutes());
  };

  U.copy = function (obj) {
    return JSON.parse(JSON.stringify(obj));
  };

  QH.Utils = U;
})(window);
