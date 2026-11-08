/*!
 * 记把好账 · 本地解锁安全模块
 * - 6 位数字密码用 PBKDF2-SHA256（随机盐）保存，不保存明文；
 * - 指纹只通过 Android 原生 BiometricPrompt 验证，网页不接触指纹数据；
 * - 连续输错会写入本地锁定时间，重启 App 也不会绕过。
 */
(function () {
  'use strict';

  const QH = window.QH;
  const Store = QH.Store;

  const MAX_ATTEMPTS = 5;
  const LOCK_STEPS = [30 * 1000, 60 * 1000, 120 * 1000, 300 * 1000, 600 * 1000];
  const PBKDF2_ROUNDS = 120000;

  const DEFAULTS = {
    setupDone: false,
    enabled: false,
    pinEnabled: false,
    biometricEnabled: false,
    pinHash: '',
    pinSalt: '',
    failedAttempts: 0,
    lockUntil: 0
  };

  let locked = false;

  function normalize(raw) {
    const s = Object.assign({}, DEFAULTS, raw && typeof raw === 'object' ? raw : {});
    s.setupDone = !!s.setupDone;
    s.pinEnabled = !!s.pinEnabled && !!s.pinHash && !!s.pinSalt;
    s.biometricEnabled = !!s.biometricEnabled;
    s.enabled = !!s.enabled && (s.pinEnabled || s.biometricEnabled);
    s.failedAttempts = Math.max(0, Math.floor(Number(s.failedAttempts) || 0));
    s.lockUntil = Math.max(0, Number(s.lockUntil) || 0);
    s.pinHash = String(s.pinHash || '');
    s.pinSalt = String(s.pinSalt || '');
    return s;
  }

  function get() {
    return normalize(Store.getSettings().security);
  }

  function save(patch) {
    const next = Object.assign({}, get(), patch || {});
    Store.setSettings({ security: next });
    return normalize(next);
  }

  function init() {
    const s = get();
    locked = s.setupDone && s.enabled;
  }

  /* ---------------- 密码哈希 ---------------- */

  function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(String(value || ''));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  function safeEqual(a, b) {
    a = String(a || '');
    b = String(b || '');
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  function subtleCrypto() {
    return window.crypto && window.crypto.subtle ? window.crypto.subtle : null;
  }

  async function derive(pin, salt) {
    const subtle = subtleCrypto();
    if (!subtle || typeof TextEncoder === 'undefined') {
      throw new Error('当前环境不支持安全密码，请在 Android App 中使用');
    }
    const key = await subtle.importKey(
      'raw',
      new TextEncoder().encode(String(pin)),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    const bits = await subtle.deriveBits(
      { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ROUNDS, hash: 'SHA-256' },
      key,
      256
    );
    return new Uint8Array(bits);
  }

  async function makeHash(pin) {
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const bits = await derive(pin, salt);
    return { salt: bytesToBase64(salt), hash: bytesToBase64(bits) };
  }

  /* ---------------- 状态 ---------------- */

  function needsSetup() {
    return !get().setupDone;
  }

  function isEnabled() {
    return get().enabled;
  }

  function isLocked() {
    return locked && isEnabled();
  }

  function lock() {
    locked = true;
  }

  function unlockSession() {
    locked = false;
  }

  function lockRemainingMs() {
    const until = get().lockUntil;
    return Math.max(0, until - Date.now());
  }

  function attemptsLeft() {
    return Math.max(0, MAX_ATTEMPTS - get().failedAttempts);
  }

  function completeUnlock() {
    locked = false;
    save({ failedAttempts: 0, lockUntil: 0 });
  }

  /* ---------------- 设置 ---------------- */

  async function setPin(pin) {
    if (!/^\d{6}$/.test(String(pin || ''))) throw new Error('请输入 6 位数字密码');
    const h = await makeHash(pin);
    locked = false;
    save({
      setupDone: true,
      enabled: true,
      pinEnabled: true,
      pinHash: h.hash,
      pinSalt: h.salt,
      failedAttempts: 0,
      lockUntil: 0
    });
  }

  function disable() {
    locked = false;
    save({
      setupDone: true,
      enabled: false,
      pinEnabled: false,
      biometricEnabled: false,
      pinHash: '',
      pinSalt: '',
      failedAttempts: 0,
      lockUntil: 0
    });
  }

  function setPinEnabled(enabled) {
    const s = get();
    if (enabled && (!s.pinHash || !s.pinSalt)) throw new Error('请先设置 6 位密码');
    const next = { pinEnabled: !!enabled };
    next.enabled = !!(enabled || s.biometricEnabled);
    if (!next.enabled) {
      next.pinHash = '';
      next.pinSalt = '';
      next.setupDone = true;
    }
    save(next);
  }

  function setBiometric(enabled) {
    const s = get();
    const next = { biometricEnabled: !!enabled };
    next.enabled = !!(s.pinEnabled || enabled);
    if (!next.enabled) {
      next.pinHash = '';
      next.pinSalt = '';
      next.setupDone = true;
    }
    save(next);
  }

  async function verifyPin(pin) {
    const s = get();
    const now = Date.now();
    if (s.lockUntil > now) {
      return { ok: false, lockedMs: s.lockUntil - now, attemptsLeft: 0, lockedOut: true };
    }
    if (!s.pinHash || !s.pinSalt) {
      return { ok: false, error: 'no_pin', attemptsLeft: 0 };
    }
    if (!/^\d{6}$/.test(String(pin || ''))) {
      return { ok: false, error: 'format', attemptsLeft: attemptsLeft() };
    }
    let matched = false;
    try {
      const bits = await derive(pin, base64ToBytes(s.pinSalt));
      matched = safeEqual(bytesToBase64(bits), s.pinHash);
    } catch (e) {
      return { ok: false, error: 'crypto', attemptsLeft: 0, message: e.message };
    }
    if (matched) {
      save({ failedAttempts: 0, lockUntil: 0 });
      return { ok: true };
    }
    const attempts = s.failedAttempts + 1;
    let lockedMs = 0;
    let lockUntil = 0;
    if (attempts >= MAX_ATTEMPTS) {
      lockedMs = LOCK_STEPS[Math.min(attempts - MAX_ATTEMPTS, LOCK_STEPS.length - 1)];
      lockUntil = now + lockedMs;
    }
    save({ failedAttempts: attempts, lockUntil: lockUntil });
    return {
      ok: false,
      attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts),
      lockedMs: lockedMs,
      lockedOut: lockedMs > 0,
      attempts: attempts
    };
  }

  /* ---------------- 指纹 ---------------- */

  function biometricStatus() {
    const bridge = window.QHAndroid;
    if (!bridge || typeof bridge.biometricStatus !== 'function') return 'no_bridge';
    try {
      return String(bridge.biometricStatus() || 'unavailable');
    } catch (e) {
      return 'unavailable';
    }
  }

  function authenticateBiometric() {
    const bridge = window.QHAndroid;
    if (!bridge || typeof bridge.authenticateBiometric !== 'function') return false;
    if (biometricStatus() !== 'ok') return false;
    try {
      bridge.authenticateBiometric();
      return true;
    } catch (e) {
      return false;
    }
  }

  QH.Security = {
    MAX_ATTEMPTS: MAX_ATTEMPTS,
    init: init,
    get: get,
    needsSetup: needsSetup,
    isEnabled: isEnabled,
    isLocked: isLocked,
    lock: lock,
    unlockSession: unlockSession,
    lockRemainingMs: lockRemainingMs,
    attemptsLeft: attemptsLeft,
    completeUnlock: completeUnlock,
    setPin: setPin,
    verifyPin: verifyPin,
    disable: disable,
    setPinEnabled: setPinEnabled,
    setBiometric: setBiometric,
    biometricStatus: biometricStatus,
    authenticateBiometric: authenticateBiometric
  };
})(window);
