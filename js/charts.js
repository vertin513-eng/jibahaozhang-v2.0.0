/*!
 * 记把好账 · 轻量图表
 * 纯 SVG 手写，无第三方依赖；支持深色模式（颜色随 CSS 变量 / 入参）。
 */
(function (global) {
  'use strict';
  const QH = global.QH;
  const U = QH.Utils;
  const Charts = {};

  /* ---------------- 环形图 ---------------- */

  /**
   * @param {Array<{name:string,value:number,color:string}>} items
   * @param {{size?:number,stroke?:number,centerTop?:string,centerValue?:string,centerSub?:string}} opts
   */
  Charts.donut = function (items, opts) {
    opts = opts || {};
    const size = opts.size || 168;
    const stroke = opts.stroke || 20;
    const valid = (items || []).filter(function (i) {
      return i.value > 0;
    });
    const total = U.sum(valid, function (i) { return i.value; });
    const r = (size - stroke) / 2;
    const cx = size / 2;
    const cy = size / 2;
    const c = 2 * Math.PI * r;
    const gap = valid.length > 1 ? Math.min(3, c * 0.008) : 0;
    let acc = 0;
    let segs = '';
    valid.forEach(function (item) {
      const len = (item.value / total) * c;
      const dash = Math.max(len - gap, 0.6);
      segs +=
        '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + item.color +
        '" stroke-width="' + stroke + '" stroke-linecap="butt" stroke-dasharray="' + dash + ' ' + (c - dash) +
        '" stroke-dashoffset="' + (-acc) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"' +
        '><title>' + U.escapeHTML(item.name) + ' ' + U.percentText(item.value, total, 1) + '</title></circle>';
      acc += len;
    });

    const inner = valid.length
      ? segs
      : '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--line)" stroke-width="' + stroke + '"/>';

    return (
      '<div class="donut" style="--donut-size:' + size + 'px">' +
      '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" role="img" aria-label="分类占比图">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--chart-track)" stroke-width="' + stroke + '"/>' +
      inner +
      '</svg>' +
      '<div class="donut-center">' +
      '<span class="donut-top">' + U.escapeHTML(opts.centerTop || '总支出') + '</span>' +
      '<strong class="donut-value">' + U.escapeHTML(opts.centerValue || '') + '</strong>' +
      (opts.centerSub ? '<span class="donut-sub">' + U.escapeHTML(opts.centerSub) + '</span>' : '') +
      '</div>' +
      '</div>'
    );
  };

  /* ---------------- 折线图 ---------------- */

  function niceMax(max) {
    if (!(max > 0)) return 10;
    const raw = max / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    return step * 4;
  }

  /**
   * @param {{
   *  labels:string[],
   *  series:Array<{name:string,color:string,values:number[],fill?:boolean}>,
   *  width?:number,height?:number,format?:(n:number)=>string,labelEvery?:number
   * }} opts
   */
  Charts.line = function (opts) {
    const labels = opts.labels || [];
    const series = opts.series || [];
    const width = opts.width || 360;
    const height = opts.height || 220;
    const pad = { l: 38, r: 10, t: 14, b: 26 };
    const innerW = width - pad.l - pad.r;
    const innerH = height - pad.t - pad.b;
    const allValues = series.reduce(function (acc, s) { return acc.concat(s.values || []); }, []);
    const max = Math.max.apply(null, [1].concat(allValues));
    const top = niceMax(max);
    const fmt = opts.format || function (n) { return U.axisShort(n); };
    const n = labels.length;
    const xAt = function (i) {
      if (n <= 1) return pad.l + innerW / 2;
      return pad.l + (i / (n - 1)) * innerW;
    };
    const yAt = function (v) {
      return pad.t + (1 - v / top) * innerH;
    };

    let svg = '<svg class="line-svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="收支趋势图">';

    // 横向网格 + Y 轴刻度
    for (let k = 0; k <= 4; k++) {
      const v = (top / 4) * k;
      const y = yAt(v);
      svg += '<line x1="' + pad.l + '" y1="' + y + '" x2="' + (width - pad.r) + '" y2="' + y + '" stroke="var(--chart-grid)" stroke-width="1" ' + (k === 0 ? '' : 'stroke-dasharray="3 5"') + '/>';
      svg += '<text x="' + (pad.l - 7) + '" y="' + (y + 3.5) + '" text-anchor="end" class="chart-axis">' + U.escapeHTML(fmt(v)) + '</text>';
    }

    // X 轴标签（自动抽稀）
    const every = opts.labelEvery || Math.max(1, Math.ceil(n / 6));
    for (let i = 0; i < n; i++) {
      const show = n <= 8 || i === 0 || i === n - 1 || i % every === 0;
      if (!show) continue;
      const x = xAt(i);
      svg += '<text x="' + x + '" y="' + (height - 6) + '" text-anchor="middle" class="chart-axis">' + U.escapeHTML(labels[i]) + '</text>';
    }

    // 面积 + 折线
    series.forEach(function (s, si) {
      const vals = s.values || [];
      if (!vals.length) return;
      const points = vals.map(function (v, i) { return [xAt(i), yAt(v)]; });
      if (s.fill && si === 0) {
        const gid = 'qh-area-' + Math.random().toString(36).slice(2, 8);
        svg +=
          '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="' + s.color + '" stop-opacity="0.22"/>' +
          '<stop offset="100%" stop-color="' + s.color + '" stop-opacity="0"/></linearGradient></defs>';
        svg +=
          '<path d="M' + points[0][0] + ',' + yAt(0) + ' L' +
          points.map(function (p) { return p[0] + ',' + p[1]; }).join(' L') +
          ' L' + points[points.length - 1][0] + ',' + yAt(0) + ' Z" fill="url(#' + gid + ')"/>';
      }
      svg +=
        '<path d="M' + points.map(function (p) { return p[0] + ',' + p[1]; }).join(' L') +
        '" fill="none" stroke="' + s.color + '" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>';
      if (n <= 12) {
        points.forEach(function (p, i) {
          svg +=
            '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3.2" fill="var(--card)" stroke="' + s.color + '" stroke-width="2">' +
            '<title>' + U.escapeHTML(labels[i]) + ' · ' + U.escapeHTML(s.name) + ' ' + U.escapeHTML(fmt(vals[i])) + '</title></circle>';
        });
      }
    });

    svg += '</svg>';
    return '<div class="line-chart">' + svg + '</div>';
  };

  /* ---------------- 横向比例条 ---------------- */

  Charts.barRow = function (label, valueText, percent, color) {
    return (
      '<div class="bar-row">' +
      '<div class="bar-row-head"><span>' + U.escapeHTML(label) + '</span><b>' + U.escapeHTML(valueText) + '</b></div>' +
      '<div class="bar-track"><i style="width:' + U.clamp(percent, 0, 100).toFixed(1) + '%;background:' + color + '"></i></div>' +
      '</div>'
    );
  };

  QH.Charts = Charts;
})(window);
