/*!
 * 记把好账 · 数据层
 * 全部账单、预算、设置均保存在浏览器 localStorage，不上传任何服务器。
 */
(function (global) {
  'use strict';
  const QH = global.QH;
  const U = QH.Utils;
  const STORAGE_KEY = 'qinghe.ledger.v1';

  /* ---------------- 分类定义 ---------------- */

  const DEFAULT_CATEGORIES = [
    { id: 'breakfast', name: '早餐', icon: 'sunrise', color: '#E8A33D', meal: true, type: 'expense' },
    { id: 'lunch', name: '午餐', icon: 'bowl', color: '#4F9D69', meal: true, type: 'expense' },
    { id: 'dinner', name: '晚餐', icon: 'moon', color: '#3D7E8C', meal: true, type: 'expense' },
    { id: 'fruit', name: '水果', icon: 'fruit', color: '#D9534F', type: 'expense' },
    { id: 'snack', name: '加餐', icon: 'snack', color: '#C97B4A', type: 'expense' },
    { id: 'transport', name: '交通', icon: 'bus', color: '#5B8DEF', type: 'expense' },
    { id: 'shopping', name: '购物', icon: 'bag', color: '#D97A9B', type: 'expense' },
    { id: 'entertainment', name: '娱乐', icon: 'game', color: '#9B7BD6', type: 'expense' },
    { id: 'daily', name: '日用', icon: 'basket', color: '#B08A4F', type: 'expense' },
    { id: 'bath', name: '洗澡', icon: 'shower', color: '#4F9BA8', type: 'expense' },
    { id: 'water', name: '饮水', icon: 'water', color: '#5A9BD5', type: 'expense' },
    { id: 'laundry', name: '洗衣', icon: 'shirt', color: '#6E86C9', type: 'expense' },
    { id: 'housing', name: '住房', icon: 'home', color: '#B26B52', type: 'expense' },
    { id: 'other', name: '其他', icon: 'dots', color: '#8B97A3', type: 'expense' }
  ];
  const INCOME_CAT = { id: 'income', name: '收入', icon: 'wallet', color: '#2F9E6E', type: 'income' };
  const DEFAULT_MEALS = ['breakfast', 'lunch', 'dinner'];
  /* 自定义分类可选的图标（必须与 index.html 内联 sprite 的 i-* 一致） */
  const CATEGORY_ICONS = [
    'sunrise', 'bowl', 'moon', 'fruit', 'snack', 'utensils', 'bus', 'bag', 'game', 'basket',
    'shower', 'water', 'shirt', 'home', 'dots', 'leaf', 'fire', 'sparkles', 'palette', 'target',
    'bell', 'shield', 'database', 'file', 'lock', 'sun', 'chart', 'calendar', 'pencil', 'download',
    'upload', 'refresh', 'search', 'info'
  ];
  const CATEGORY_COLORS = ['#5B8DEF', '#D97A9B', '#9B7BD6', '#4F9BA8', '#C97B4A', '#6E86C9', '#4F9D69', '#B26B52', '#C08457', '#7A9E5A', '#A96B8E', '#5C7CA8'];
  const CATEGORIES = [];
  const MEALS = [];
  const CAT_MAP = {};

  function copyCategories(list) {
    return list.map(function (c) { return Object.assign({}, c); });
  }

  function defaultCategories() {
    return copyCategories(DEFAULT_CATEGORIES);
  }

  function normalizeCategoryName(value) {
    let name = String(value == null ? '' : value).trim();
    if (name.normalize) name = name.normalize('NFKC').trim();
    return name;
  }

  function categoryMapFor(list) {
    const map = { income: INCOME_CAT };
    list.forEach(function (c) { map[c.id] = c; });
    return map;
  }

  /* app.js 会缓存这三个引用，因此分类变化时必须原地更新。 */
  function replaceCategories(list) {
    CATEGORIES.splice.apply(CATEGORIES, [0, CATEGORIES.length].concat(copyCategories(list)));
    MEALS.splice.apply(MEALS, [0, MEALS.length].concat(CATEGORIES.filter(function (c) { return c.meal; }).map(function (c) { return c.id; })));
    Object.keys(CAT_MAP).forEach(function (id) { delete CAT_MAP[id]; });
    Object.assign(CAT_MAP, categoryMapFor(CATEGORIES));
  }

  function sanitizeCategory(c, index) {
    if (!c || typeof c !== 'object') return null;
    const id = String(c.id || '');
    const name = normalizeCategoryName(c.name);
    if (!/^[a-z][a-z0-9_-]{0,47}$/.test(id) || id === 'income') return null;
    if (!name || Array.from(name).length > 12) return null;
    return {
      id: id,
      name: name,
      icon: CATEGORY_ICONS.indexOf(c.icon) >= 0 ? c.icon : 'dots',
      color: /^#[0-9a-fA-F]{6}$/.test(c.color || '') ? c.color : CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      meal: DEFAULT_MEALS.indexOf(id) >= 0 && !!c.meal,
      type: 'expense'
    };
  }

  function sanitizeCategories(input) {
    const source = Array.isArray(input) ? input : defaultCategories();
    const out = [];
    const ids = {};
    const names = { 收入: true };
    source.forEach(function (raw, index) {
      const c = sanitizeCategory(raw, index);
      if (!c || ids[c.id]) return;
      const key = normalizeCategoryName(c.name).toLowerCase();
      if (names[key]) return;
      ids[c.id] = true;
      names[key] = true;
      out.push(c);
    });
    // “其他”是兜底分类，永远排在最后一位
    const otherObj = Object.assign({}, DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length - 1]);
    const rest = out.filter(function (c) { return c.id !== 'other'; });
    rest.push(otherObj);
    return rest;
  }

  const THEMES = {
    matcha: { name: '抹茶绿', primary: '#4F9D69', strong: '#3C8253', soft: 'rgba(79,157,105,.13)', tint: '#E7F2EA', heroA: '#DCEFE1', heroB: '#F4F9F5', meta: '#4F9D69' },
    ocean: { name: '海盐蓝', primary: '#4A84A6', strong: '#366A88', soft: 'rgba(74,132,166,.13)', tint: '#E4EFF4', heroA: '#DCECF4', heroB: '#F4F9FB', meta: '#4A84A6' },
    tangerine: { name: '暖杏橙', primary: '#C07A3E', strong: '#9C5F2B', soft: 'rgba(192,122,62,.14)', tint: '#F7ECDF', heroA: '#F6E7D5', heroB: '#FCF8F3', meta: '#C07A3E' },
    sakura: { name: '樱花粉', primary: '#C46B85', strong: '#A4526A', soft: 'rgba(196,107,133,.13)', tint: '#F8E9EE', heroA: '#F6E3E9', heroB: '#FDF8FA', meta: '#C46B85' },
    indigo: { name: '远山紫', primary: '#7568B8', strong: '#5B4F9B', soft: 'rgba(117,104,184,.13)', tint: '#EEEBF8', heroA: '#E7E3F4', heroB: '#F9F8FC', meta: '#7568B8' }
  };

  /* ---------------- 账户定义 ---------------- */

  const DEFAULT_ACCOUNTS = [
    { id: 'wechat', name: '微信', icon: 'chat', color: '#4F9D69' },
    { id: 'alipay', name: '支付宝', icon: 'wallet', color: '#4A84A6' },
    { id: 'bank', name: '银行卡', icon: 'card', color: '#C07A3E' }
  ];
  const ACCOUNT_ICONS = ['chat', 'wallet', 'card', 'bag', 'home', 'leaf', 'chart', 'dots', 'shield', 'target', 'sparkles', 'database'];
  const ACCOUNT_COLORS = ['#4F9D69', '#4A84A6', '#C07A3E', '#C46B85', '#7568B8', '#4F9BA8', '#B08A4F', '#5C7CA8'];
  const ACCOUNTS = [];
  const ACCOUNT_MAP = {};

  function copyAccounts(list) {
    return list.map(function (a) { return Object.assign({}, a); });
  }

  function defaultAccounts() {
    return DEFAULT_ACCOUNTS.map(function (a) {
      return Object.assign({}, a, { initialBalance: 0, startDate: U.today() });
    });
  }

  function sanitizeAccount(a, index) {
    if (!a || typeof a !== 'object') return null;
    const id = String(a.id || '');
    const name = normalizeCategoryName(a.name);
    if (!/^[a-z][a-z0-9_-]{0,47}$/.test(id)) return null;
    if (!name || Array.from(name).length > 12) return null;
    return {
      id: id,
      name: name,
      icon: ACCOUNT_ICONS.indexOf(a.icon) >= 0 ? a.icon : 'wallet',
      color: /^#[0-9a-fA-F]{6}$/.test(a.color || '') ? a.color : ACCOUNT_COLORS[index % ACCOUNT_COLORS.length],
      initialBalance: Math.max(0, Math.min(999999999, U.round2(U.toNumber(a.initialBalance)))),
      startDate: U.isYmd(a.startDate) ? a.startDate : U.today()
    };
  }

  function sanitizeAccounts(input) {
    const source = Array.isArray(input) && input.length ? input : defaultAccounts();
    const out = [];
    const ids = {};
    const names = {};
    source.forEach(function (raw, index) {
      const a = sanitizeAccount(raw, index);
      if (!a || ids[a.id]) return;
      const key = normalizeCategoryName(a.name).toLowerCase();
      if (names[key]) return;
      ids[a.id] = true;
      names[key] = true;
      out.push(a);
    });
    return out.length ? out : defaultAccounts();
  }

  function accountMapFor(list) {
    const map = {};
    list.forEach(function (a) { map[a.id] = a; });
    return map;
  }

  /* app.js 会缓存 ACCOUNTS / ACCOUNT_MAP，账户变化时必须原地更新。 */
  function replaceAccounts(list) {
    const clean = sanitizeAccounts(list);
    ACCOUNTS.splice.apply(ACCOUNTS, [0, ACCOUNTS.length].concat(copyAccounts(clean)));
    Object.keys(ACCOUNT_MAP).forEach(function (id) { delete ACCOUNT_MAP[id]; });
    Object.assign(ACCOUNT_MAP, accountMapFor(ACCOUNTS));
  }

  /* ---------------- 默认数据 ---------------- */

  function emptyCategoryBudgets(categories) {
    const out = {};
    (categories || CATEGORIES).forEach(function (c) {
      out[c.id] = 0;
    });
    return out;
  }

  function sanitizeCategoryBudgets(input, categories) {
    const out = emptyCategoryBudgets(categories);
    Object.keys(input || {}).forEach(function (id) {
      if (Object.prototype.hasOwnProperty.call(out, id)) {
        out[id] = Math.max(0, U.round2(U.toNumber(input[id])));
      }
    });
    return out;
  }

  function defaultSettings() {
    return {
      currency: '¥',
      theme: 'matcha',
      themeMode: 'system',
      reminders: {
        summary: { enabled: false, time: '21:00' },
        log: { enabled: false, time: '20:00' },
        weekly: { enabled: false, time: '20:00', weekday: 1 },
        monthly: { enabled: false, time: '20:00', day: 1 },
        yearly: { enabled: false, time: '20:00', month: 1, day: 1 }
      },
      recognition: { enabled: false },
      quick: { ball: false, notifyQuick: false },
      lastAccountId: 'wechat',
      createdAt: new Date().toISOString()
    };
  }

  function defaults() {
    const categories = defaultCategories();
    return {
      version: 2,
      categories: categories,
      accounts: defaultAccounts(),
      transactions: [],
      budgets: { monthly: 0, categories: emptyCategoryBudgets(categories), calibrations: {}, monthlyHistory: {} },
      settings: defaultSettings(),
      dayNotes: {},
      meta: { demo: false, lastBackupAt: null, onboarded: false }
    };
  }

  /* ---------------- 状态 ---------------- */

  let db = null;
  let storageOK = true;
  const listeners = [];

  function notify() {
    listeners.forEach(function (fn) {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    });
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch (e) {
      storageOK = false;
      console.warn('本地存储写入失败：', e);
    }
  }

  function commit() {
    save();
    notify();
  }

  /** 合并历史版本缺省字段，保证向前兼容；解析备份时不会改动当前分类。 */
  function migrate(raw) {
    const base = defaults();
    if (!raw || typeof raw !== 'object') return base;
    const categories = Array.isArray(raw.categories) ? sanitizeCategories(raw.categories) : base.categories;
    const catMap = categoryMapFor(categories);
    const mealIds = categories.filter(function (c) { return c.meal; }).map(function (c) { return c.id; });

    const rawSettings = (raw && raw.settings) || {};
    const hasAccounts = Array.isArray(raw.accounts) && raw.accounts.length > 0;
    let accounts = sanitizeAccounts(raw.accounts);
    let legacyDefaultAccountId = '';
    if (!hasAccounts) {
      // 单账户版本升级：旧余额与旧流水全部归到“银行卡”，其余账户从 0 开始。
      accounts = defaultAccounts();
      let startDate = U.isYmd(rawSettings.accountStartDate) ? rawSettings.accountStartDate : '';
      if (!startDate) {
        const dates = (Array.isArray(raw.transactions) ? raw.transactions : [])
          .map(function (t) { return t.date; })
          .filter(U.isYmd)
          .sort();
        startDate = dates[0] || U.today();
      }
      accounts.forEach(function (a) { a.startDate = startDate; });
      const bank = accounts.filter(function (a) { return a.id === 'bank'; })[0] || accounts[0];
      const legacyInitial = rawSettings.accountInitialBalance != null
        ? rawSettings.accountInitialBalance : rawSettings.accountBalance;
      bank.initialBalance = Math.max(0, Math.min(999999999, U.round2(U.toNumber(legacyInitial))));
      legacyDefaultAccountId = bank.id;
    }
    const accountMap = accountMapFor(accounts);

    const out = {
      version: 2,
      categories: categories,
      accounts: accounts,
      transactions: Array.isArray(raw.transactions) ? raw.transactions.map(function (t) {
        return sanitizeTx(t, catMap, mealIds, accountMap);
      }).filter(Boolean) : [],
      budgets: {
        monthly: Math.max(0, U.toNumber(raw.budgets && raw.budgets.monthly)),
        categories: sanitizeCategoryBudgets(raw.budgets && raw.budgets.categories, categories),
        calibrations: Object.assign({}, (raw.budgets && raw.budgets.calibrations) || {}),
        monthlyHistory: Object.assign({}, (raw.budgets && raw.budgets.monthlyHistory) || {})
      },
      settings: Object.assign({}, base.settings, raw.settings || {}),
      dayNotes: Object.assign({}, (raw && raw.dayNotes) || {}),
      meta: Object.assign({}, base.meta, raw.meta || {})
    };
    // 旧版单一 reminder -> 新版 reminders
    if (raw.settings && raw.settings.reminder && !raw.settings.reminders) {
      out.settings.reminders = {
        summary: { enabled: !!raw.settings.reminder.enabled, time: raw.settings.reminder.time || '21:00' },
        log: { enabled: false, time: '20:00' }
      };
      delete out.settings.reminder;
    }
    out.settings.reminders = Object.assign({}, base.settings.reminders, out.settings.reminders || {});
    ['summary', 'log', 'weekly', 'monthly', 'yearly'].forEach(function (k) {
      out.settings.reminders[k] = Object.assign(
        { enabled: false, time: k === 'summary' ? '21:00' : '20:00', weekday: 1, day: 1, month: 1 },
        out.settings.reminders[k]
      );
    });
    out.settings.recognition = Object.assign({ enabled: false }, out.settings.recognition || {});
    out.settings.quick = Object.assign({ ball: false, notifyQuick: false }, out.settings.quick || {});
    // 旧版单账户字段已迁移到 accounts，不再留在 settings。
    delete out.settings.accountBalance;
    delete out.settings.accountInitialBalance;
    delete out.settings.accountStartDate;
    if (legacyDefaultAccountId) out.settings.lastAccountId = legacyDefaultAccountId;
    if (!accountMap[out.settings.lastAccountId]) out.settings.lastAccountId = accounts[0].id;
    Object.keys(out.budgets.categories).forEach(function (k) {
      out.budgets.categories[k] = Math.max(0, U.toNumber(out.budgets.categories[k]));
    });
    if (!THEMES[out.settings.theme]) out.settings.theme = 'matcha';
    if (['system', 'light', 'dark'].indexOf(out.settings.themeMode) < 0) out.settings.themeMode = 'system';
    return out;
  }

  function accountFallbackId(accountMap) {
    if (accountMap.bank) return 'bank';
    const keys = Object.keys(accountMap);
    return keys.length ? keys[0] : 'bank';
  }

  function sanitizeTx(t, catMap, mealIds, accountMap) {
    if (!t || typeof t !== 'object') return null;
    const map = catMap || CAT_MAP;
    const meals = mealIds || MEALS;
    const accounts = accountMap || ACCOUNT_MAP;
    const amount = U.round2(U.toNumber(t.amount));
    if (!(amount >= 0)) return null;
    const date = U.isYmd(t.date) ? t.date : U.today();
    const time = /^\d{2}:\d{2}$/.test(t.time || '') ? t.time : '12:00';
    const note = typeof t.note === 'string' ? t.note.slice(0, 60) : '';

    if (t.type === 'transfer') {
      const from = accounts[t.fromAccountId] ? t.fromAccountId : '';
      const to = accounts[t.toAccountId] ? t.toAccountId : '';
      if (!from || !to || from === to || amount <= 0) return null;
      return {
        id: t.id || U.uid(),
        type: 'transfer',
        amount: amount,
        category: '',
        fromAccountId: from,
        toAccountId: to,
        note: note,
        date: date,
        time: time,
        uneaten: false,
        createdAt: t.createdAt || new Date().toISOString()
      };
    }

    const type = t.type === 'income' ? 'income' : 'expense';
    let category = t.category;
    if (type === 'income') category = 'income';
    else if (!map[category] || category === 'income') category = 'other';
    // 三餐可记 0 元“未用餐”；删除三餐分类后，也保留已有的 0 元历史记录。
    const zeroMeal = amount === 0 && type === 'expense' && meals.indexOf(category) >= 0;
    const preservedZero = amount === 0 && type === 'expense' && !!t.uneaten;
    if (!(amount > 0) && !zeroMeal && !preservedZero) return null;
    const accountId = accounts[t.accountId] ? t.accountId : accountFallbackId(accounts);
    return {
      id: t.id || U.uid(),
      type: type,
      amount: amount,
      accountId: accountId,
      category: category,
      note: note,
      date: date,
      time: time,
      uneaten: zeroMeal || preservedZero || (!!t.uneaten && meals.indexOf(category) >= 0),
      createdAt: t.createdAt || new Date().toISOString()
    };
  }

  /* ---------------- 演示数据 ---------------- */

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const BREAKFAST_NOTES = ['豆浆油条', '包子豆浆', '三明治', '燕麦拿铁', '小笼包', '煎饼果子', '面包牛奶'];
  const LUNCH_NOTES = ['公司食堂', '牛肉面', '轻食沙拉', '黄焖鸡米饭', '日式定食', '便利店午餐', '煲仔饭'];
  const DINNER_NOTES = ['家常菜', '番茄鸡蛋面', '和朋友聚餐', '水饺', '麻辣烫', '自己做饭', '寿司'];
  const SHOP_NOTES = ['纸巾补货', '洗衣液', '耳机', '换季衣物', '超市采购', '护肤品'];
  const FUN_NOTES = ['电影票', '咖啡店', '游戏充值', '周末展览', 'KTV'];
  const DAILY_NOTES = ['水果', '牛奶', '牙膏', '打车备用', '快递运费'];
  const TRANS_NOTES = ['地铁', '公交', '共享单车', '打车', '高铁票'];

  function seedDemo(target) {
    const rnd = mulberry32(20261019);
    const pick = function (arr) {
      return arr[Math.floor(rnd() * arr.length)];
    };
    const chance = function (p) {
      return rnd() < p;
    };
    const amount = function (min, max) {
      return Math.round(min + rnd() * (max - min));
    };
    const push = function (date, category, amt, note, h, m, type) {
      target.transactions.push(
        sanitizeTx({
          id: U.uid(),
          date: U.ymd(date),
          time: U.pad2(h) + ':' + U.pad2(m),
          type: type || 'expense',
          category: category,
          amount: amt,
          note: note
        })
      );
    };

    const now = new Date();
    const months = [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 1)];

    months.forEach(function (monthStart, idx) {
      const isCurrent = idx === 1;
      const year = monthStart.getFullYear();
      const month = monthStart.getMonth();
      const dim = U.daysInMonth(year, month);
      const lastDay = isCurrent ? now.getDate() : dim;

      // 固定大额：房租与工资
      push(new Date(year, month, 1), 'housing', 1500, '房租', 10, 0);
      if (lastDay >= 10) push(new Date(year, month, 10), 'income', 12000, '工资', 9, 30, 'income');

      for (let day = 1; day <= lastDay; day++) {
        const d = new Date(year, month, day);
        const isToday = U.ymd(d) === U.today();

        if (chance(isToday ? 1 : 0.86)) {
          push(d, 'breakfast', amount(5, 16), pick(BREAKFAST_NOTES), 7 + Math.floor(rnd() * 2), Math.floor(rnd() * 50));
        }
        if (chance(isToday ? 1 : 0.94)) {
          push(d, 'lunch', amount(14, 38), pick(LUNCH_NOTES), 11 + Math.floor(rnd() * 2), 20 + Math.floor(rnd() * 35));
        }
        if (chance(isToday ? 0.45 : 0.78)) {
          push(d, 'dinner', amount(16, 58), pick(DINNER_NOTES), 17 + Math.floor(rnd() * 3), Math.floor(rnd() * 50));
        }
        if (chance(0.42)) push(d, 'transport', amount(2, 28), pick(TRANS_NOTES), chance(0.6) ? 8 : 18, Math.floor(rnd() * 50));
        if (chance(0.16)) push(d, 'shopping', amount(25, 260), pick(SHOP_NOTES), 13 + Math.floor(rnd() * 8), Math.floor(rnd() * 55));
        if (chance(0.08)) push(d, 'entertainment', amount(20, 160), pick(FUN_NOTES), 19, Math.floor(rnd() * 55));
        if (chance(0.13)) push(d, 'daily', amount(8, 68), pick(DAILY_NOTES), 16, Math.floor(rnd() * 55));
        if (chance(0.05)) push(d, 'other', amount(10, 80), '临时支出', 15, Math.floor(rnd() * 55));
        if (chance(0.03)) push(d, 'income', amount(100, 600), '兼职收入', 20, 0, 'income');
      }

      // 周末加一顿聚餐，让数据更生动
      for (let day = 1; day <= lastDay; day++) {
        const d = new Date(year, month, day);
        if (d.getDay() === 6 && chance(0.55)) {
          push(d, 'dinner', amount(60, 180), '周末聚餐', 18, 30);
        }
      }
    });

    target.meta.demo = true;
    target.budgets.monthly = 5000;
    target.budgets.categories = sanitizeCategoryBudgets({
      breakfast: 300,
      lunch: 700,
      dinner: 800,
      transport: 300,
      shopping: 400,
      entertainment: 300,
      daily: 300,
      housing: 1300,
      other: 200
    }, CATEGORIES);
    return target;
  }

  /* ---------------- 初始化 / 订阅 ---------------- */

  function init() {
    let stored = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch (e) {
      storageOK = false;
      console.warn('读取本地数据失败：', e);
    }

    if (stored) db = migrate(stored);
    else db = defaults();
    replaceCategories(db.categories);
    db.categories = CATEGORIES;
    replaceAccounts(db.accounts);
    db.accounts = ACCOUNTS;
    if (!stored) {
      const params = new URLSearchParams(global.location.search);
      if (!params.has('empty')) seedDemo(db);
      save();
    }
    if (!Array.isArray(db.transactions)) db.transactions = [];
    return db;
  }

  function subscribe(fn) {
    listeners.push(fn);
    return function () {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  /* ---------------- 查询 ---------------- */

  function all() {
    return db.transactions.slice();
  }

  function sorted() {
    return db.transactions.slice().sort(function (a, b) {
      return (b.date + b.time).localeCompare(a.date + a.time);
    });
  }

  function inRange(from, to, type) {
    return db.transactions.filter(function (t) {
      return t.date >= from && t.date <= to && (!type || t.type === type);
    });
  }

  function byDate(date) {
    return sorted().filter(function (t) {
      return t.date === date;
    });
  }

  function categoryOf(t) {
    return CAT_MAP[t.category] || CAT_MAP.other;
  }

  function summarize(list) {
    let expense = 0;
    let income = 0;
    let count = 0;
    const byCat = {};
    const meals = { breakfast: 0, lunch: 0, dinner: 0 };
    list.forEach(function (t) {
      if (t.type === 'transfer') return; // 转账不计入收支
      count++;
      if (t.type === 'income') {
        income += t.amount;
      } else {
        expense += t.amount;
        byCat[t.category] = (byCat[t.category] || 0) + t.amount;
        if (MEALS.indexOf(t.category) >= 0) meals[t.category] += t.amount;
      }
    });
    return {
      expense: U.round2(expense),
      income: U.round2(income),
      balance: U.round2(income - expense),
      byCat: byCat,
      meals: meals,
      count: count
    };
  }

  function daySummary(date) {
    const s = summarize(byDate(date));
    s.date = date;
    return s;
  }

  /** 日历用：按日聚合支出/收入/分类色点 */
  function dayMap(from, to) {
    const map = {};
    db.transactions.forEach(function (t) {
      if (t.type === 'transfer') return; // 转账不计入日历收支
      if (t.date < from || t.date > to) return;
      if (!map[t.date]) map[t.date] = { expense: 0, income: 0, cats: {} };
      const cell = map[t.date];
      if (t.type === 'income') {
        cell.income += t.amount;
      } else {
        cell.expense += t.amount;
        cell.cats[t.category] = (cell.cats[t.category] || 0) + t.amount;
      }
    });
    Object.keys(map).forEach(function (k) {
      map[k].expense = U.round2(map[k].expense);
      map[k].income = U.round2(map[k].income);
    });
    return map;
  }

  function monthSummary(year, month) {
    const from = U.ymd(new Date(year, month, 1));
    const to = U.ymd(new Date(year, month, U.daysInMonth(year, month)));
    const s = summarize(inRange(from, to));
    s.from = from;
    s.to = to;
    return s;
  }

  function categoryBreakdown(list) {
    const s = summarize(list);
    return CATEGORIES.map(function (c) {
      return { cat: c, amount: U.round2(s.byCat[c.id] || 0) };
    })
      .filter(function (x) {
        return x.amount > 0;
      })
      .sort(function (a, b) {
        return b.amount - a.amount;
      });
  }

  function mealBreakdown(list) {
    const s = summarize(list);
    return MEALS.map(function (id) {
      const cat = CAT_MAP[id];
      const count = list.filter(function (t) {
        return t.type === 'expense' && t.category === id;
      }).length;
      return {
        cat: cat,
        amount: U.round2(s.meals[id]),
        count: count,
        percent: s.expense ? (s.meals[id] / s.expense) * 100 : 0
      };
    });
  }

  /* ---------------- 账单变更 ---------------- */

  function addTransaction(input) {
    const tx = sanitizeTx(input);
    if (!tx) throw new Error('金额无效');
    db.transactions.push(tx);
    if (tx.type !== 'transfer' && tx.accountId) db.settings.lastAccountId = tx.accountId;
    db.meta.demo = false;
    commit();
    return tx;
  }

  /** 自动识别 / 账单导入共用指纹，避免同一条交易重复入账。 */
  function fingerprint(t) {
    return [
      t.date,
      t.time || '00:00',
      t.type,
      U.round2(U.toNumber(t.amount)).toFixed(2),
      t.category || '',
      t.accountId || '',
      t.fromAccountId || '',
      t.toAccountId || '',
      (t.note || '').trim()
    ].join('|');
  }

  function hasDuplicate(tx, extraSet) {
    const fp = fingerprint(tx);
    if (extraSet && extraSet.has(fp)) return true;
    return db.transactions.some(function (t) {
      return fingerprint(t) === fp;
    });
  }

  /** 批量入账（导入预览、识别确认），同一批内部也去重。 */
  function addTransactions(items) {
    const added = [];
    let skipped = 0;
    const seen = new Set();
    (items || []).forEach(function (raw) {
      const tx = sanitizeTx(raw);
      if (!tx || hasDuplicate(tx, seen)) {
        skipped++;
        return;
      }
      seen.add(fingerprint(tx));
      added.push(tx);
    });
    if (added.length) {
      db.transactions = db.transactions.concat(added);
      db.meta.demo = false;
      commit();
    }
    return { added: added.length, skipped: skipped };
  }

  function updateTransaction(id, patch) {
    const idx = db.transactions.findIndex(function (t) {
      return t.id === id;
    });
    if (idx < 0) return null;
    const merged = sanitizeTx(Object.assign({}, db.transactions[idx], patch, { id: id }));
    if (!merged) throw new Error('金额无效');
    db.transactions[idx] = merged;
    commit();
    return merged;
  }

  function removeTransaction(id) {
    const before = db.transactions.length;
    db.transactions = db.transactions.filter(function (t) {
      return t.id !== id;
    });
    if (db.transactions.length !== before) {
      commit();
      return true;
    }
    return false;
  }

  function clearTransactions() {
    db.transactions = [];
    db.meta.demo = false;
    commit();
  }

  function loadDemo() {
    // 只替换账单与预算，保留用户分类、账户、主题、货币、提醒与引导状态
    const keepSettings = db && db.settings ? JSON.parse(JSON.stringify(db.settings)) : defaultSettings();
    const keepMeta = db && db.meta ? { onboarded: db.meta.onboarded, lastBackupAt: db.meta.lastBackupAt } : {};
    const keepCategories = db && Array.isArray(db.categories) ? copyCategories(db.categories) : defaultCategories();
    const keepAccounts = db && Array.isArray(db.accounts) ? copyAccounts(db.accounts) : defaultAccounts();
    db = defaults();
    db.settings = keepSettings;
    Object.assign(db.meta, keepMeta);
    replaceCategories(keepCategories);
    db.categories = CATEGORIES;
    replaceAccounts(keepAccounts);
    db.accounts = ACCOUNTS;
    seedDemo(db);
    commit();
  }

  /* ---------------- 分类管理 ---------------- */

  /** 新分类自动沿用最少使用的颜色，避免和已有分类撞色。 */
  function pickCategoryColor() {
    const used = {};
    CATEGORIES.forEach(function (c) {
      used[String(c.color || '').toLowerCase()] = (used[String(c.color || '').toLowerCase()] || 0) + 1;
    });
    let best = CATEGORY_COLORS[0];
    let bestCount = Infinity;
    CATEGORY_COLORS.forEach(function (color) {
      const n = used[color.toLowerCase()] || 0;
      if (n < bestCount) {
        bestCount = n;
        best = color;
      }
    });
    return best;
  }

  function addCategory(input) {
    const opts = input && typeof input === 'object' ? input : { name: input };
    const name = normalizeCategoryName(opts.name);
    if (!name) throw new Error('请输入分类名称');
    if (Array.from(name).length > 12) throw new Error('分类名称最多 12 个字符');
    const key = name.toLowerCase();
    const duplicate = CATEGORIES.concat([INCOME_CAT]).some(function (c) {
      return normalizeCategoryName(c.name).toLowerCase() === key;
    });
    if (duplicate) throw new Error('已存在同名分类');

    let id = '';
    do {
      id = 'cat_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    } while (CAT_MAP[id]);
    const cat = {
      id: id,
      name: name,
      icon: CATEGORY_ICONS.indexOf(opts.icon) >= 0 ? opts.icon : 'dots',
      color: /^#[0-9a-fA-F]{6}$/.test(opts.color || '') ? opts.color : pickCategoryColor(),
      meal: false,
      type: 'expense'
    };
    // 新分类插在“其他”之前，保证“其他”始终在末位
    const next = CATEGORIES.slice();
    const otherIndex = next.findIndex(function (c) { return c.id === 'other'; });
    if (otherIndex >= 0) next.splice(otherIndex, 0, cat);
    else next.push(cat);
    db.categories = next;
    replaceCategories(next);
    db.categories = CATEGORIES;
    db.budgets.categories[cat.id] = 0;
    commit();
    return cat;
  }

  function removeCategory(id) {
    if (id === 'other' || id === 'income') throw new Error('默认分类不能删除');
    const cat = CAT_MAP[id];
    if (!cat || cat.type !== 'expense') throw new Error('分类不存在');
    let moved = 0;
    db.transactions = db.transactions.map(function (t) {
      if (t.type !== 'expense' || t.category !== id) return t;
      moved++;
      return Object.assign({}, t, { category: 'other' });
    });
    db.categories = CATEGORIES.filter(function (c) { return c.id !== id; });
    replaceCategories(db.categories);
    db.categories = CATEGORIES;
    delete db.budgets.categories[id];
    db.meta.demo = false;
    commit();
    return { category: cat, moved: moved };
  }

  /** 重命名：只改显示名称，账单/预算都按 id 关联，不受影响。 */
  function renameCategory(id, value) {
    const cat = CAT_MAP[id];
    if (!cat || id === 'income') throw new Error('分类不存在');
    if (id === 'other') throw new Error('“其他”是兜底分类，不能重命名');
    const name = normalizeCategoryName(value);
    if (!name) throw new Error('请输入分类名称');
    if (Array.from(name).length > 12) throw new Error('分类名称最多 12 个字符');
    const key = name.toLowerCase();
    const duplicate = CATEGORIES.concat([INCOME_CAT]).some(function (c) {
      return c.id !== id && normalizeCategoryName(c.name).toLowerCase() === key;
    });
    if (duplicate) throw new Error('已存在同名分类');
    if (cat.name === name) return cat;
    cat.name = name;
    commit();
    return cat;
  }

  /**
   * 分类排序：只在同类分组内换位（三餐 ↔ 三餐、日常 ↔ 日常），
   * “其他”固定排在最后，不允许被换动。
   */
  function categoryNeighbor(id, dir) {
    const idx = CATEGORIES.findIndex(function (c) { return c.id === id; });
    if (idx < 0) return -1;
    const cat = CATEGORIES[idx];
    if (cat.id === 'other') return -1;
    const j = idx + (dir === 'up' ? -1 : 1);
    if (j < 0 || j >= CATEGORIES.length) return -1;
    const next = CATEGORIES[j];
    if (next.id === 'other' || !!next.meal !== !!cat.meal) return -1;
    return j;
  }

  function canMoveCategory(id, dir) {
    return categoryNeighbor(id, dir) >= 0;
  }

  function moveCategory(id, dir) {
    const j = categoryNeighbor(id, dir);
    if (j < 0) return false;
    const idx = CATEGORIES.findIndex(function (c) { return c.id === id; });
    const next = CATEGORIES.slice();
    next[idx] = CATEGORIES[j];
    next[j] = CATEGORIES[idx];
    replaceCategories(next);
    db.categories = CATEGORIES;
    commit();
    return true;
  }

  /**
   * 按给定 id 顺序重排（拖拽结束时调用）。
   * 未出现在列表里的分类按原顺序补在后面，“其他”始终压到末位。
   */
  function reorderCategories(orderedIds) {
    if (!Array.isArray(orderedIds) || !orderedIds.length) return false;
    const byId = {};
    CATEGORIES.forEach(function (c) { byId[c.id] = c; });
    const seen = {};
    const next = [];
    orderedIds.forEach(function (id) {
      if (byId[id] && !seen[id]) {
        next.push(byId[id]);
        seen[id] = true;
      }
    });
    CATEGORIES.forEach(function (c) {
      if (!seen[c.id]) next.push(c);
    });
    const otherIndex = next.findIndex(function (c) { return c.id === 'other'; });
    if (otherIndex >= 0 && otherIndex !== next.length - 1) {
      const other = next.splice(otherIndex, 1)[0];
      next.push(other);
    }
    const before = CATEGORIES.map(function (c) { return c.id; }).join(',');
    if (next.map(function (c) { return c.id; }).join(',') === before) return false;
    replaceCategories(next);
    db.categories = CATEGORIES;
    commit();
    return true;
  }

  /* ---------------- 预算 ---------------- */

  function getBudgets() {
    return db.budgets;
  }

  function monthKey(year, month) {
    return year + '-' + String(month + 1).padStart(2, '0');
  }

  function setBudgets(next) {
    const old = db.budgets || {};
    const monthly = Math.max(0, U.round2(U.toNumber(next.monthly)));
    db.budgets = {
      monthly: monthly,
      categories: sanitizeCategoryBudgets(next.categories, CATEGORIES),
      calibrations: Object.assign({}, old.calibrations || {}),
      monthlyHistory: Object.assign({}, old.monthlyHistory || {})
    };
    Object.keys(db.budgets.categories).forEach(function (k) {
      db.budgets.categories[k] = Math.max(0, U.round2(U.toNumber(db.budgets.categories[k])));
    });
    // 快照当前月的总预算，供累计结余按“当月预算”计算，避免历史月份被新预算覆盖。
    const now = new Date();
    const key = monthKey(now.getFullYear(), now.getMonth());
    db.budgets.monthlyHistory[key] = monthly;
    commit();
  }

  /** 手动校准某月“已消费”：只影响预算与累计结余，不改动任何账单明细。 */
  function setCalibration(year, month, value) {
    const key = monthKey(year, month);
    if (value == null || value === '') delete db.budgets.calibrations[key];
    else db.budgets.calibrations[key] = Math.max(0, U.round2(U.toNumber(value)));
    commit();
  }

  function getCalibration(year, month) {
    const v = db.budgets.calibrations[monthKey(year, month)];
    return v == null ? null : U.round2(v);
  }

  function monthBudget(year, month) {
    const key = monthKey(year, month);
    const h = db.budgets.monthlyHistory[key];
    return h == null ? U.round2(db.budgets.monthly || 0) : U.round2(h);
  }

  /** 预算口径的已消费：有手动校准就用校准值，否则用账单合计。 */
  function effectiveSpent(year, month) {
    const cal = getCalibration(year, month);
    if (cal != null) return cal;
    return monthSummary(year, month).expense;
  }

  function budgetStatus(year, month) {
    const now = new Date();
    const isCurrent = now.getFullYear() === year && now.getMonth() === month;
    const dim = U.daysInMonth(year, month);
    const actual = monthSummary(year, month).expense;
    const spent = effectiveSpent(year, month);
    const total = monthBudget(year, month);
    const remaining = U.round2(total - spent);
    const daysLeft = isCurrent ? dim - now.getDate() + 1 : dim;
    const dailyAvg = total > 0 ? total / dim : 0;
    const todayAvailable = total > 0 && remaining > 0 ? remaining / Math.max(1, daysLeft) : 0;
    return {
      total: total,
      spent: spent,
      actual: actual,
      calibrated: getCalibration(year, month) != null,
      remaining: remaining,
      over: total > 0 && remaining < 0,
      noBudget: total <= 0,
      percent: total > 0 ? (spent / total) * 100 : 0,
      dailyAvg: U.round2(dailyAvg),
      todayAvailable: U.round2(todayAvailable),
      daysLeft: daysLeft,
      daysInMonth: dim
    };
  }

  /** 单月结余；没有账单、校准或历史预算的月份记为 0，避免把当前预算套到所有空月份。 */
  function monthBalance(y, m) {
    const key = monthKey(y, m);
    const cal = getCalibration(y, m);
    const spent = effectiveSpent(y, m);
    const now = new Date();
    const isCurrent = y === now.getFullYear() && m === now.getMonth();
    const hasData = spent > 0 || cal != null || db.budgets.monthlyHistory[key] != null || isCurrent;
    if (!hasData) return 0;
    return U.round2(monthBudget(y, m) - spent);
  }

  /** 近 N 个月结余：单月结余 = 当月总预算 − 当月实际支出（可按校准值）。 */
  function balanceHistory(count) {
    const n = count || 12;
    const now = new Date();
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = d.getMonth();
      const budget = monthBudget(y, m);
      const spent = effectiveSpent(y, m);
      out.push({
        key: monthKey(y, m),
        year: y,
        month: m,
        label: (m + 1) + '月',
        budget: budget,
        spent: spent,
        balance: monthBalance(y, m)
      });
    }
    return out;
  }

  /** 累计结余：从最早一笔账单所在月份累加到当前月。 */
  function cumulativeBalance() {
    const list = db.transactions;
    const now = new Date();
    if (!list.length) {
      // 没有账单时仍把当前月预算 / 校准计入，避免月中校准后累计结余恒为 0
      const current = monthBalance(now.getFullYear(), now.getMonth());
      return { total: current, months: current === 0 ? 0 : 1 };
    }
    let first = list[0].date;
    list.forEach(function (t) {
      if (t.date < first) first = t.date;
    });
    const start = U.parseYmd(first);
    let total = 0;
    let months = 0;
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= now) {
      const y = cursor.getFullYear();
      const m = cursor.getMonth();
      total += monthBalance(y, m);
      months++;
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return { total: U.round2(total), months: months };
  }

  /* ---------------- 设置 ---------------- */

  function getSettings() {
    return db.settings;
  }

  /* ---------------- 多账户 ---------------- */

  function accounts() {
    return copyAccounts(ACCOUNTS);
  }

  function accountById(id) {
    return ACCOUNT_MAP[id] || null;
  }

  function accountTransactions(id) {
    return sorted().filter(function (t) {
      if (t.type === 'transfer') return t.fromAccountId === id || t.toAccountId === id;
      return t.accountId === id;
    });
  }

  /** 统计页用：默认总账；指定账户时只看该账户的收支，转账永远不计入统计。 */
  function statsList(list, accountId) {
    return (list || []).filter(function (t) {
      if (t.type === 'transfer') return false;
      return !accountId || accountId === 'all' || t.accountId === accountId;
    });
  }

  function accountSummary(id) {
    const target = ACCOUNT_MAP[id];
    if (!target) return null;
    let income = 0;
    let expense = 0;
    let transferIn = 0;
    let transferOut = 0;
    let count = 0;
    let balance = target.initialBalance;
    db.transactions.forEach(function (t) {
      if (!t.date || t.date < target.startDate) return;
      if (t.type === 'income' && t.accountId === id) {
        income += t.amount;
        balance += t.amount;
        count++;
      } else if (t.type === 'expense' && t.accountId === id) {
        expense += t.amount;
        balance -= t.amount;
        count++;
      } else if (t.type === 'transfer') {
        if (t.fromAccountId === id) {
          transferOut += t.amount;
          balance -= t.amount;
          count++;
        }
        if (t.toAccountId === id) {
          transferIn += t.amount;
          balance += t.amount;
          count++;
        }
      }
    });
    return Object.assign({}, target, {
      ready: true,
      balance: U.round2(balance),
      income: U.round2(income),
      expense: U.round2(expense),
      transferIn: U.round2(transferIn),
      transferOut: U.round2(transferOut),
      count: count
    });
  }

  function accountsSummary() {
    const list = ACCOUNTS.map(function (a) { return accountSummary(a.id); }).filter(Boolean);
    return {
      accounts: list,
      count: list.length,
      total: U.round2(list.reduce(function (sum, a) { return sum + a.balance; }, 0))
    };
  }

  function getAccountOpening(id) {
    const a = ACCOUNT_MAP[id];
    return a ? { initial: a.initialBalance, startDate: a.startDate } : { initial: 0, startDate: '' };
  }

  function setAccountOpening(id, initial, startDate) {
    const a = ACCOUNT_MAP[id];
    if (!a) throw new Error('账户不存在');
    if (!U.isYmd(startDate)) throw new Error('请选择初始基准日期');
    a.initialBalance = Math.max(0, Math.min(999999999, U.round2(U.toNumber(initial))));
    a.startDate = startDate;
    db.accounts = ACCOUNTS;
    commit();
    return accountSummary(id);
  }

  function defaultAccountId() {
    const id = db.settings.lastAccountId;
    if (ACCOUNT_MAP[id]) return id;
    return ACCOUNTS[0] ? ACCOUNTS[0].id : 'wechat';
  }

  function pickAccountColor() {
    const used = {};
    ACCOUNTS.forEach(function (a) {
      used[String(a.color || '').toLowerCase()] = true;
    });
    for (let i = 0; i < ACCOUNT_COLORS.length; i++) {
      if (!used[ACCOUNT_COLORS[i].toLowerCase()]) return ACCOUNT_COLORS[i];
    }
    return ACCOUNT_COLORS[ACCOUNTS.length % ACCOUNT_COLORS.length];
  }

  function addAccount(input) {
    const opts = input && typeof input === 'object' ? input : { name: input };
    const name = normalizeCategoryName(opts.name);
    if (!name) throw new Error('请输入账户名称');
    if (Array.from(name).length > 12) throw new Error('账户名称最多 12 个字符');
    const key = name.toLowerCase();
    if (ACCOUNTS.some(function (a) { return normalizeCategoryName(a.name).toLowerCase() === key; })) {
      throw new Error('已存在同名账户');
    }
    let id = '';
    do {
      id = 'acc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    } while (ACCOUNT_MAP[id]);
    const account = {
      id: id,
      name: name,
      icon: ACCOUNT_ICONS.indexOf(opts.icon) >= 0 ? opts.icon : 'wallet',
      color: /^#[0-9a-fA-F]{6}$/.test(opts.color || '') ? opts.color : pickAccountColor(),
      initialBalance: 0,
      startDate: U.today()
    };
    ACCOUNTS.push(account);
    ACCOUNT_MAP[id] = account;
    db.accounts = ACCOUNTS;
    commit();
    return account;
  }

  function updateAccount(id, patch) {
    const a = ACCOUNT_MAP[id];
    if (!a) throw new Error('账户不存在');
    if (Object.prototype.hasOwnProperty.call(patch || {}, 'name')) {
      const name = normalizeCategoryName(patch.name);
      if (!name) throw new Error('请输入账户名称');
      if (Array.from(name).length > 12) throw new Error('账户名称最多 12 个字符');
      const key = name.toLowerCase();
      if (ACCOUNTS.some(function (x) { return x.id !== id && normalizeCategoryName(x.name).toLowerCase() === key; })) {
        throw new Error('已存在同名账户');
      }
      a.name = name;
    }
    if (patch && ACCOUNT_ICONS.indexOf(patch.icon) >= 0) a.icon = patch.icon;
    if (patch && /^#[0-9a-fA-F]{6}$/.test(patch.color || '')) a.color = patch.color;
    db.accounts = ACCOUNTS;
    commit();
    return a;
  }

  function accountBalance(id) {
    return accountSummary(id);
  }

  function getAccountBalance() {
    return accountsSummary().total;
  }

  function isTransfer(t) {
    return !!t && t.type === 'transfer';
  }

  function setSettings(patch) {
    db.settings = Object.assign({}, db.settings, patch || {});
    if (patch && patch.reminders) {
      db.settings.reminders = Object.assign({}, defaultSettings().reminders, patch.reminders);
    }
    commit();
  }

  function setReminder(kind, patch) {
    const r = db.settings.reminders[kind] || { enabled: false, time: '21:00' };
    db.settings.reminders[kind] = Object.assign({}, r, patch);
    commit();
  }

  function getMeta() {
    return db.meta;
  }

  function markBackup() {
    db.meta.lastBackupAt = new Date().toISOString();
    commit();
  }

  /* 新人引导只自动出现一次，标记写入本地数据库。 */
  function markOnboarded() {
    if (db.meta.onboarded) return;
    db.meta.onboarded = true;
    commit();
  }

  /* ---------------- 导出 / 备份 ---------------- */

  function rowsOf(list) {
    const header = ['日期', '时间', '类型', '账户', '分类', '金额', '备注'];
    const rows = list.slice().sort(function (a, b) {
      return (b.date + b.time).localeCompare(a.date + a.time);
    }).map(function (t) {
      if (t.type === 'transfer') {
        const from = ACCOUNT_MAP[t.fromAccountId];
        const to = ACCOUNT_MAP[t.toAccountId];
        return [t.date, t.time, '转账', (from ? from.name : '?') + ' → ' + (to ? to.name : '?'), '转账', t.amount.toFixed(2), t.note || ''];
      }
      const account = ACCOUNT_MAP[t.accountId];
      return [
        t.date,
        t.time,
        t.type === 'income' ? '收入' : '支出',
        account ? account.name : '',
        categoryOf(t).name,
        t.amount.toFixed(2),
        t.uneaten ? '未用餐' : (t.note || '')
      ];
    });
    return [header].concat(rows);
  }

  function exportRows() {
    return rowsOf(sorted());
  }

  function exportRowsOf(list) {
    return rowsOf(list || []);
  }

  function csvCell(v) {
    const s = String(v == null ? '' : v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCSV() {
    const text = '\ufeff' + exportRows().map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    return new Blob([text], { type: 'text/csv;charset=utf-8' });
  }

  function xmlEscape(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Excel 2003 XML（.xls），Excel / WPS / Numbers 均可直接打开，无需任何第三方库 */
  function exportExcel() {
    const rows = exportRows();
    const colWidths = [90, 60, 56, 86, 70, 90, 220];
    const head = rows[0];
    const body = rows.slice(1);
    let xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<?mso-application progid="Excel.Sheet"?>\n' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n' +
      ' xmlns:o="urn:schemas-microsoft-com:office:office"\n' +
      ' xmlns:x="urn:schemas-microsoft-com:office:excel"\n' +
      ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"\n' +
      ' xmlns:html="http://www.w3.org/TR/REC-html40">\n' +
      '<Styles>\n' +
      '<Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Microsoft YaHei" ss:Size="11"/></Style>\n' +
      '<Style ss:ID="head"><Font ss:FontName="Microsoft YaHei" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#4F9D69" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>\n' +
      '<Style ss:ID="money"><NumberFormat ss:Format="#,##0.00"/><Alignment ss:Horizontal="Right"/></Style>\n' +
      '<Style ss:ID="date"><Alignment ss:Horizontal="Center"/></Style>\n' +
      '</Styles>\n' +
      '<Worksheet ss:Name="账单明细"><Table>\n';
    colWidths.forEach(function (w) {
      xml += '<Column ss:AutoFitWidth="0" ss:Width="' + w + '"/>\n';
    });
    xml += '<Row ss:Height="26">';
    head.forEach(function (h) {
      xml += '<Cell ss:StyleID="head"><Data ss:Type="String">' + xmlEscape(h) + '</Data></Cell>';
    });
    xml += '</Row>\n';
    body.forEach(function (r) {
      xml += '<Row>';
      xml += '<Cell ss:StyleID="date"><Data ss:Type="String">' + xmlEscape(r[0]) + '</Data></Cell>';
      xml += '<Cell ss:StyleID="date"><Data ss:Type="String">' + xmlEscape(r[1]) + '</Data></Cell>';
      xml += '<Cell><Data ss:Type="String">' + xmlEscape(r[2]) + '</Data></Cell>';
      xml += '<Cell><Data ss:Type="String">' + xmlEscape(r[3]) + '</Data></Cell>';
      xml += '<Cell><Data ss:Type="String">' + xmlEscape(r[4]) + '</Data></Cell>';
      xml += '<Cell ss:StyleID="money"><Data ss:Type="Number">' + r[5] + '</Data></Cell>';
      xml += '<Cell><Data ss:Type="String">' + xmlEscape(r[6]) + '</Data></Cell>';
      xml += '</Row>\n';
    });
    xml += '</Table>\n<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions>\n</Worksheet>\n</Workbook>';
    return new Blob(['\ufeff' + xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
  }

  function backupObject() {
    // 深拷贝：备份对象生成后不能被后续记账操作改动
    const data = JSON.parse(JSON.stringify(db));
    // 设备锁属于本机安全设置，不写入备份，避免密码哈希随文件流出。
    if (data.settings) delete data.settings.security;
    return {
      app: '记把好账',
      schema: 2,
      exportedAt: new Date().toISOString(),
      data: data
    };
  }

  function backupBlob() {
    return new Blob([JSON.stringify(backupObject(), null, 2)], { type: 'application/json;charset=utf-8' });
  }

  function parseBackup(text) {
    let obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      throw new Error('文件不是有效的 JSON 备份');
    }
    const data = obj && obj.data ? obj.data : obj;
    if (!data || !Array.isArray(data.transactions)) {
      throw new Error('备份内容缺少账单数据');
    }
    return migrate(data);
  }

  function restore(data) {
    // 备份不含设备锁；恢复后保留当前设备的解锁设置，避免被旧备份关掉。
    const keepSecurity = db && db.settings ? db.settings.security : null;
    db = migrate(data);
    if (keepSecurity) db.settings.security = keepSecurity;
    replaceCategories(db.categories);
    db.categories = CATEGORIES;
    replaceAccounts(db.accounts);
    db.accounts = ACCOUNTS;
    db.meta.demo = false;
    commit();
  }

  /* ---------------- 对外接口 ---------------- */

  QH.Store = {
    STORAGE_KEY: STORAGE_KEY,
    CATEGORIES: CATEGORIES,
    INCOME_CAT: INCOME_CAT,
    MEALS: MEALS,
    CAT_MAP: CAT_MAP,
    THEMES: THEMES,
    CATEGORY_ICONS: CATEGORY_ICONS,
    CATEGORY_COLORS: CATEGORY_COLORS,
    ACCOUNTS: ACCOUNTS,
    ACCOUNT_MAP: ACCOUNT_MAP,
    ACCOUNT_ICONS: ACCOUNT_ICONS,
    ACCOUNT_COLORS: ACCOUNT_COLORS,
    init: init,
    subscribe: subscribe,
    all: all,
    sorted: sorted,
    inRange: inRange,
    byDate: byDate,
    categoryOf: categoryOf,
    summarize: summarize,
    daySummary: daySummary,
    dayMap: dayMap,
    monthSummary: monthSummary,
    categoryBreakdown: categoryBreakdown,
    mealBreakdown: mealBreakdown,
    addTransaction: addTransaction,
    addCategory: addCategory,
    removeCategory: removeCategory,
    renameCategory: renameCategory,
    moveCategory: moveCategory,
    canMoveCategory: canMoveCategory,
    reorderCategories: reorderCategories,
    updateTransaction: updateTransaction,
    removeTransaction: removeTransaction,
    clearTransactions: clearTransactions,

    /* ---- 日历备注：只存“日期 → 短备注”，与账单联动展示 ---- */
    getDayNote: function (date) {
      if (!U.isYmd(date)) return '';
      const notes = db.dayNotes || {};
      return notes[date] || '';
    },
    setDayNote: function (date, text) {
      if (!U.isYmd(date)) return false;
      if (!db.dayNotes) db.dayNotes = {};
      const value = String(text == null ? '' : text).trim().slice(0, 20);
      if (value) db.dayNotes[date] = value;
      else delete db.dayNotes[date];
      commit();
      return true;
    },
    notesBetween: function (from, to) {
      const out = {};
      Object.keys(db.dayNotes || {}).forEach(function (k) {
        if (k >= from && k <= to) out[k] = db.dayNotes[k];
      });
      return out;
    },
    /* 备注关键词搜索：检索全部账单备注，同时给出关联总花费；可限定起止日期 */
    noteStats: function (keyword, range) {
      const q = String(keyword || '').trim().toLowerCase();
      const from = range && U.isYmd(range.from) ? range.from : '';
      const to = range && U.isYmd(range.to) ? range.to : '';
      if (!q) return { query: '', from: from, to: to, count: 0, expense: 0, income: 0, list: [] };
      const accountId = range && range.accountId ? range.accountId : '';
      const list = db.transactions.filter(function (t) {
        if (t.type === 'transfer') return false;
        if (from && t.date < from) return false;
        if (to && t.date > to) return false;
        if (accountId && accountId !== 'all' && t.accountId !== accountId) return false;
        return String(t.note || '').toLowerCase().indexOf(q) >= 0;
      }).sort(function (a, b) { return (b.date + b.time).localeCompare(a.date + a.time); });
      let expense = 0;
      let income = 0;
      list.forEach(function (t) {
        if (t.type === 'income') income += t.amount;
        else expense += t.amount;
      });
      return { query: q, from: from, to: to, count: list.length, expense: U.round2(expense), income: U.round2(income), list: list };
    },
    loadDemo: loadDemo,
    getBudgets: getBudgets,
    setBudgets: setBudgets,
    budgetStatus: budgetStatus,
    monthKey: monthKey,
    setCalibration: setCalibration,
    getCalibration: getCalibration,
    monthBudget: monthBudget,
    monthBalance: monthBalance,
    effectiveSpent: effectiveSpent,
    balanceHistory: balanceHistory,
    cumulativeBalance: cumulativeBalance,
    fingerprint: fingerprint,
    hasDuplicate: hasDuplicate,
    addTransactions: addTransactions,
    exportRowsOf: exportRowsOf,
    getSettings: getSettings,
    setSettings: setSettings,
    accounts: accounts,
    accountById: accountById,
    accountSummary: accountSummary,
    accountsSummary: accountsSummary,
    accountTransactions: accountTransactions,
    statsList: statsList,
    defaultAccountId: defaultAccountId,
    addAccount: addAccount,
    updateAccount: updateAccount,
    getAccountOpening: getAccountOpening,
    setAccountOpening: setAccountOpening,
    accountBalance: accountBalance,
    getAccountBalance: getAccountBalance,
    isTransfer: isTransfer,
    setReminder: setReminder,
    getMeta: getMeta,
    markBackup: markBackup,
    markOnboarded: markOnboarded,
    exportRows: exportRows,
    exportCSV: exportCSV,
    exportExcel: exportExcel,
    backupObject: backupObject,
    backupBlob: backupBlob,
    parseBackup: parseBackup,
    restore: restore,
    isStorageOK: function () { return storageOK; }
  };
})(window);
