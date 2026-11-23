/**
 * Luna · 统一持久化层
 * 根键固定为 luna_pet_data，默认结构见 RULES.md「核心契约 → storage.js」。
 *
 * 设计要点：
 * - 所有对外返回值都是深拷贝，调用方改不到内部根引用；
 * - set() 按路径局部写入，只替换目标叶子，不覆盖同级字段；
 * - localStorage 不可用（隐私模式、配额满、被禁用）时自动降级为内存存储，
 *   对外接口保持不变，页面不会崩。
 */

/** 统一根键 */
export const STORAGE_KEY = 'luna_pet_data';

/** 当前数据结构版本 */
export const SCHEMA_VERSION = 1;

/** 默认数据结构工厂：每次返回全新对象，避免共享引用 */
function createDefaultData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: {
      theme: 'light',
      renderMode: 'svg',
    },
    pet: {
      manualSleep: false,
    },
  };
}

/** 内存兜底：localStorage 不可用时使用 */
let memoryStore = null;

/** 深拷贝：优先 structuredClone，回退 JSON 方式 */
function deepClone(value) {
  if (value === null || typeof value !== 'object') return value;
  try {
    if (typeof structuredClone === 'function') return structuredClone(value);
  } catch (err) {
    // 继续走 JSON 回退
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    return null;
  }
}

/** 是否为普通对象（排除数组 / null） */
function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

/** 把已存数据合并到默认结构上：缺失字段补默认值，已有字段以已存值优先 */
function mergeWithDefaults(defaults, stored) {
  if (!isPlainObject(stored)) return defaults;

  const result = {};
  const keys = new Set([...Object.keys(defaults), ...Object.keys(stored)]);

  keys.forEach((key) => {
    const base = defaults[key];
    const incoming = stored[key];

    if (isPlainObject(base) && isPlainObject(incoming)) {
      result[key] = mergeWithDefaults(base, incoming);
      return;
    }
    result[key] = incoming === undefined ? base : deepClone(incoming);
  });

  return result;
}

/** 把路径字符串拆成段：支持 "settings.theme" 与 ["settings", "theme"] */
function normalizePath(keyPath) {
  if (Array.isArray(keyPath)) {
    return keyPath.filter((seg) => typeof seg === 'string' && seg.length > 0);
  }
  if (typeof keyPath !== 'string') return [];
  return keyPath
    .split('.')
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0);
}

/** 特性检测：localStorage 是否真的可读写 */
function detectStorage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probeKey = '__luna_probe__';
    localStorage.setItem(probeKey, '1');
    localStorage.removeItem(probeKey);
    return localStorage;
  } catch (err) {
    return null;
  }
}

/** 读取原始字符串（失败返回 null） */
function readRaw() {
  const store = detectStorage();
  if (!store) return memoryStore;

  try {
    return store.getItem(STORAGE_KEY);
  } catch (err) {
    return memoryStore;
  }
}

/** 写入原始字符串（失败时写内存兜底并返回 false） */
function writeRaw(rawText) {
  memoryStore = rawText;
  const store = detectStorage();
  if (!store) return false;

  try {
    store.setItem(STORAGE_KEY, rawText);
    return true;
  } catch (err) {
    // 配额超限或隐私模式：保留内存副本，不抛给调用方
    return false;
  }
}

/** 安全 JSON.parse：失败返回 null */
function safeParse(rawText) {
  if (typeof rawText !== 'string' || rawText === '') return null;
  try {
    return JSON.parse(rawText);
  } catch (err) {
    return null;
  }
}

/**
 * 读取完整数据（深拷贝）
 * 首次运行 / 数据损坏时自动回落到默认结构。
 */
export function getAll() {
  const defaults = createDefaultData();
  const parsed = safeParse(readRaw());
  const merged = mergeWithDefaults(defaults, parsed);
  return deepClone(merged) || defaults;
}

/**
 * 首次运行初始化：根键缺失或结构损坏时写入默认值。
 * @returns {boolean} 是否执行了写入
 */
export function init() {
  const rawText = readRaw();
  const parsed = safeParse(rawText);

  if (isPlainObject(parsed)) {
    const merged = mergeWithDefaults(createDefaultData(), parsed);
    // 结构缺字段时补齐；无变化则不写，减少写入次数
    if (JSON.stringify(merged) === JSON.stringify(parsed)) return false;
    return writeRaw(JSON.stringify(merged));
  }

  return writeRaw(JSON.stringify(createDefaultData()));
}

/**
 * 读取单个路径的值。
 * @param {string|string[]} keyPath 例如 "settings.theme"
 * @param {*} fallbackValue 路径不存在时的回退值
 */
export function get(keyPath, fallbackValue = undefined) {
  const segments = normalizePath(keyPath);
  if (segments.length === 0) return getAll();

  let cursor = getAll();
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== 'object') return fallbackValue;
    if (!Object.prototype.hasOwnProperty.call(cursor, segment)) return fallbackValue;
    cursor = cursor[segment];
  }

  const value = deepClone(cursor);
  return value === undefined ? fallbackValue : value;
}

/**
 * 按路径局部写入：只改目标叶子，同级与其它分支字段全部保留。
 * @param {string|string[]} keyPath 例如 "pet.manualSleep"
 * @param {*} value 要写入的值（对象会被深拷贝后写入）
 * @returns {boolean} 是否成功落盘到 localStorage
 */
export function set(keyPath, value) {
  const segments = normalizePath(keyPath);
  const root = getAll();

  if (segments.length === 0) {
    if (!isPlainObject(value)) return false;
    const merged = mergeWithDefaults(root, value);
    return writeRaw(JSON.stringify(merged));
  }

  let cursor = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    if (!isPlainObject(cursor[segment])) cursor[segment] = {};
    cursor = cursor[segment];
  }

  cursor[segments[segments.length - 1]] = deepClone(value);
  return writeRaw(JSON.stringify(root));
}

/**
 * 删除指定叶子（不常用，保留给后续步骤）。
 * @returns {boolean} 是否删除了存在的键
 */
export function remove(keyPath) {
  const segments = normalizePath(keyPath);
  if (segments.length === 0) return false;

  const root = getAll();
  let cursor = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    if (!isPlainObject(cursor[segment])) return false;
    cursor = cursor[segment];
  }

  const leaf = segments[segments.length - 1];
  if (!Object.prototype.hasOwnProperty.call(cursor, leaf)) return false;

  delete cursor[leaf];
  writeRaw(JSON.stringify(root));
  return true;
}

/** 重置为默认结构 */
export function reset() {
  memoryStore = null;
  return writeRaw(JSON.stringify(createDefaultData()));
}

/** localStorage 是否真实可用（供上层决定是否提示降级） */
export function isAvailable() {
  return detectStorage() !== null;
}

export default {
  STORAGE_KEY,
  SCHEMA_VERSION,
  init,
  getAll,
  get,
  set,
  remove,
  reset,
  isAvailable,
};
