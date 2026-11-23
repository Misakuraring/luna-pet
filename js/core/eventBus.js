/**
 * Luna · 跨模块事件总线
 * 契约见 RULES.md「核心契约 → eventBus.js」：on / emit / off。
 *
 * 设计要点：
 * - 同一事件支持挂多个监听者，按注册顺序触发；
 * - emit 前先拷贝监听者数组，监听者在回调里 on/off 不会破坏本次派发；
 * - 单个监听者抛错只记录日志，不影响其余监听者与调用方。
 */

/** event -> Map<callback, wrapper>，保证同一回调重复 on 不重复触发 */
const registry = new Map();

/** 事件名规范提示（模块:动作）；仅开发期提醒，不阻断业务 */
const EVENT_NAME_PATTERN = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/i;

function assertEventName(event) {
  if (typeof event !== 'string' || event.trim() === '') {
    throw new TypeError('[eventBus] 事件名必须是非空字符串');
  }
  if (!EVENT_NAME_PATTERN.test(event) && typeof console !== 'undefined') {
    console.warn(`[eventBus] 事件名建议遵循「模块:动作」格式，当前为 "${event}"`);
  }
  return event.trim();
}

function assertCallback(callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('[eventBus] callback 必须是函数');
  }
  return callback;
}

/**
 * 订阅事件。
 * @param {string} event 事件名，如 "pet:interaction"
 * @param {(payload: any) => void} callback 监听函数
 * @returns {() => void} 取消订阅函数
 */
export function on(event, callback) {
  const name = assertEventName(event);
  const handler = assertCallback(callback);

  if (!registry.has(name)) registry.set(name, new Map());
  const bucket = registry.get(name);

  if (bucket.has(handler)) return () => off(name, handler);

  bucket.set(handler, handler);
  return () => off(name, handler);
}

/**
 * 取消订阅。同一回调只注册一次，因此取消一次即完全移除。
 * @returns {boolean} 是否真的移除了监听者
 */
export function off(event, callback) {
  if (typeof event !== 'string' || typeof callback !== 'function') return false;

  const name = event.trim();
  const bucket = registry.get(name);
  if (!bucket || !bucket.has(callback)) return false;

  bucket.delete(callback);
  if (bucket.size === 0) registry.delete(name);
  return true;
}

/**
 * 派发事件。
 * @param {string} event 事件名，如 "system:theme-change"
 * @param {*} [payload] 传参
 * @returns {number} 成功执行的监听者数量
 */
export function emit(event, payload) {
  if (typeof event !== 'string' || event.trim() === '') return 0;

  const name = event.trim();
  const bucket = registry.get(name);
  if (!bucket || bucket.size === 0) return 0;

  // 拷贝快照：回调内 on/off 不影响本次派发
  const snapshot = Array.from(bucket.values());
  let delivered = 0;

  snapshot.forEach((handler) => {
    try {
      handler(payload);
      delivered += 1;
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.error(`[eventBus] 监听器执行异常（${name}）:`, err);
      }
    }
  });

  return delivered;
}

/** 当前某事件的监听者数量（调试用） */
export function listenerCount(event) {
  if (typeof event !== 'string') return 0;
  const bucket = registry.get(event.trim());
  return bucket ? bucket.size : 0;
}

/** 清空全部监听者（调试 / 测试用） */
export function clear() {
  registry.clear();
}

export default { on, emit, off, listenerCount, clear };
