/**
 * Luna · 统一帧循环（Step 1.3-C）
 *
 * 设计约定：
 *   1. 全应用只允许存在一个 requestAnimationFrame 循环；startLoop() 幂等，
 *      重复调用只返回当前状态，绝不产生并行循环；
 *   2. 每帧向订阅者派发 dt（单位：秒），并对异常大的帧间隔做上限钳制
 *      （MAX_DELTA = 0.1s），后台切回前台的首帧不会出现时间跳跃；
 *   3. 页面隐藏（切后台 / 锁屏）时立即取消排帧，零后台空转；回到前台时
 *      先用 performance.now() 重新校准基准时间戳，再恢复排帧；
 *   4. 无 requestAnimationFrame 的环境（极旧 WebView）自动降级为 setTimeout 排帧；
 *   5. 单个订阅者抛错只记录日志，不影响其他订阅者，也不会中断循环。
 *
 * 对外接口：
 *   onTick(cb)        → 订阅每帧回调 cb(dt, timestampMs)，返回取消订阅函数
 *   offTick(cb)       → 取消订阅，返回是否真的移除了
 *   startLoop()       → 启动循环（幂等），返回是否本次真正启动
 *   stopLoop()        → 停止循环并解绑可见性监听，返回是否真的停止
 *   isRunning()       → 当前是否在跑
 *   getLoopStats()    → 运行统计快照（深拷贝，禁止外部改内部状态）
 */

/** 单帧允许的最大时间步长（秒）：防止后台恢复首帧时间跳跃 */
export const MAX_DELTA = 0.1;

/** rAF 不可用时的降级排帧间隔（毫秒，约 60fps） */
const FALLBACK_INTERVAL = 16;

const ticks = new Set();

let running = false;
let paused = false;
/** 当前排帧句柄（rAF id 或 setTimeout id） */
let frameHandle = null;
/** 当前排帧方式：'raf' | 'timer' */
let frameMode = 'raf';
/** 上一帧的时间戳（毫秒） */
let lastTimestamp = 0;
/** 可见性监听是否已绑定 */
let visibilityBound = false;

const stats = {
  frames: 0,
  elapsed: 0,
  lastDelta: 0,
  clampedFrames: 0,
  pauses: 0,
  resumes: 0,
  startedAt: 0,
  maxFrameGap: 0,
};

function nowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function hasRaf() {
  return typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function';
}

/* --------------------------------------------------------------------------
   排帧
   -------------------------------------------------------------------------- */

function schedule() {
  if (!running || paused) return;

  if (hasRaf()) {
    frameMode = 'raf';
    frameHandle = window.requestAnimationFrame(onFrame);
    return;
  }

  // 降级：极旧环境没有 rAF 时用 setTimeout 维持同一套 dt 派发
  frameMode = 'timer';
  frameHandle = setTimeout(() => onFrame(nowMs()), FALLBACK_INTERVAL);
}

function cancelScheduled() {
  if (frameHandle === null) return;
  if (frameMode === 'raf' && hasRaf()) {
    window.cancelAnimationFrame(frameHandle);
  } else {
    clearTimeout(frameHandle);
  }
  frameHandle = null;
}

function onFrame(timestamp) {
  frameHandle = null;
  if (!running || paused) return;

  const t = typeof timestamp === 'number' ? timestamp : nowMs();
  let gapMs = t - lastTimestamp;

  // 时间戳异常（NaN / 负数 / 回退）视为 0，绝不把脏值传给订阅者
  if (!Number.isFinite(gapMs) || gapMs < 0) gapMs = 0;
  lastTimestamp = t;

  if (gapMs > stats.maxFrameGap) stats.maxFrameGap = gapMs;

  const clampedMs = gapMs > MAX_DELTA * 1000 ? MAX_DELTA * 1000 : gapMs;
  if (clampedMs !== gapMs) stats.clampedFrames += 1;

  const dt = clampedMs / 1000;
  stats.frames += 1;
  stats.elapsed += dt;
  stats.lastDelta = dt;

  dispatch(dt, t);

  if (running && !paused) schedule();
}

/** 派发一帧：先拍快照，回调内增删订阅不影响本次派发 */
function dispatch(dt, timestamp) {
  if (ticks.size === 0) return;

  const snapshot = Array.from(ticks);
  for (let i = 0; i < snapshot.length; i += 1) {
    try {
      snapshot[i](dt, timestamp);
    } catch (err) {
      console.error('[loop] 帧回调异常：', err);
    }
  }
}

/* --------------------------------------------------------------------------
   可见性生命周期
   -------------------------------------------------------------------------- */

function pause() {
  if (!running || paused) return;
  paused = true;
  cancelScheduled();
  stats.pauses += 1;
}

function resume() {
  if (!running || !paused) return;
  paused = false;
  // 关键：用当前时间重新校准基准，恢复后的首帧 dt 才不会是一大段空白
  lastTimestamp = nowMs();
  stats.resumes += 1;
  schedule();
}

function handleVisibilityChange() {
  if (typeof document === 'undefined') return;
  if (document.hidden === true) {
    pause();
  } else {
    resume();
  }
}

function handlePageHide() {
  pause();
}

function handlePageShow() {
  resume();
}

function bindVisibility() {
  if (visibilityBound || typeof document === 'undefined') return;

  if (typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }
  // 移动端切后台/被杀进程的补充信号（部分 WebView 不派发 visibilitychange）
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
  }

  visibilityBound = true;
}

function unbindVisibility() {
  if (!visibilityBound) return;

  if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }
  if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
    window.removeEventListener('pagehide', handlePageHide);
    window.removeEventListener('pageshow', handlePageShow);
  }

  visibilityBound = false;
}

/* --------------------------------------------------------------------------
   对外接口
   -------------------------------------------------------------------------- */

/** 订阅每帧回调，返回取消订阅函数 */
export function onTick(callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('[loop] onTick 需要一个函数');
  }
  ticks.add(callback);
  return () => ticks.delete(callback);
}

/** 取消订阅，返回是否真的移除了 */
export function offTick(callback) {
  if (typeof callback !== 'function') return false;
  return ticks.delete(callback);
}

/** 启动循环：幂等，已在运行时不重复排帧 */
export function startLoop() {
  if (running) {
    // 若处于暂停态（例如隐藏期间被调用），先恢复再返回
    resume();
    return false;
  }

  running = true;
  paused = false;
  lastTimestamp = nowMs();
  stats.startedAt = lastTimestamp;

  bindVisibility();

  // 页面在后台被调用时不要空转，等回到前台再排帧
  if (typeof document !== 'undefined' && document.hidden === true) {
    paused = true;
    return true;
  }

  schedule();
  return true;
}

/** 停止循环并解绑监听，返回是否真的停止 */
export function stopLoop() {
  if (!running) return false;

  running = false;
  paused = false;
  cancelScheduled();
  unbindVisibility();
  return true;
}

/** 当前是否在运行（暂停也算运行中，只是没排帧） */
export function isRunning() {
  return running;
}

/** 运行统计快照（深拷贝） */
export function getLoopStats() {
  const fps = stats.elapsed > 0 ? stats.frames / stats.elapsed : 0;
  return {
    running,
    paused,
    subscribers: ticks.size,
    frameMode,
    maxDelta: MAX_DELTA,
    frames: stats.frames,
    elapsed: Math.round(stats.elapsed * 1000) / 1000,
    lastDelta: Math.round(stats.lastDelta * 10000) / 10000,
    clampedFrames: stats.clampedFrames,
    maxFrameGap: Math.round(stats.maxFrameGap * 100) / 100,
    pauses: stats.pauses,
    resumes: stats.resumes,
    fps: Math.round(fps * 10) / 10,
  };
}

export default {
  MAX_DELTA,
  onTick,
  offTick,
  startLoop,
  stopLoop,
  isRunning,
  getLoopStats,
};
