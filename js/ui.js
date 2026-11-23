/**
 * Luna · UI 层（Step 1.1 仅实现时钟）
 * - 实时数字时钟：HH:MM 主显示 + 秒数小字，满秒刷新；
 * - 中文日期与星期；
 * - 定时器按整秒对齐，避免 setInterval 长期漂移。
 */

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/** DOM 元素 id（与 index.html 对应） */
const SELECTORS = {
  time: 'clock-time',
  seconds: 'clock-seconds',
  date: 'clock-date',
};

let timerId = null;
let elements = null;
let running = false;

function pad2(value) {
  return String(value).padStart(2, '0');
}

/** 主时间：HH:MM */
export function formatTime(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 秒数：SS */
export function formatSeconds(date) {
  return pad2(date.getSeconds());
}

/** 中文日期：2026年11月23日 星期一 */
export function formatDate(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${year}年${month}月${day}日 ${WEEKDAYS[date.getDay()]}`;
}

/** 抓取 DOM 引用；缺失则返回 null，由上层决定是否降级 */
function resolveElements() {
  if (typeof document === 'undefined') return null;

  const time = document.getElementById(SELECTORS.time);
  const seconds = document.getElementById(SELECTORS.seconds);
  const date = document.getElementById(SELECTORS.date);
  if (!time || !seconds || !date) return null;

  return { time, seconds, date };
}

/** 渲染一帧 */
function render(now) {
  if (!elements) return;
  const date = now instanceof Date ? now : new Date();

  elements.time.textContent = formatTime(date);
  elements.seconds.textContent = formatSeconds(date);
  elements.date.textContent = formatDate(date);
}

/**
 * 按整秒对齐安排下一次刷新。
 * 用 setTimeout 而非 setInterval：每次重新计算到下一个整秒的剩余毫秒，
 * 页面休眠 / 卡顿后回到前台不会累积误差。
 */
function scheduleNext() {
  if (!running) return;

  const now = new Date();
  const delay = 1000 - now.getMilliseconds();
  timerId = window.setTimeout(() => {
    const current = new Date();
    render(current);
    scheduleNext();
  }, Math.max(delay, 50));
}

/**
 * 启动时钟。
 * @returns {boolean} 是否成功启动（DOM 缺失时为 false，页面其它部分不受影响）
 */
export function startClock() {
  if (running) return true;

  elements = resolveElements();
  if (!elements) {
    console.warn('[ui] 未找到时钟节点，跳过时钟渲染');
    return false;
  }

  running = true;
  render(new Date());
  scheduleNext();

  // 回到前台立刻刷新一次，避免显示旧时间
  document.addEventListener('visibilitychange', handleVisibilityChange);

  return true;
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') render(new Date());
}

/** 停止时钟并解绑监听 */
export function stopClock() {
  running = false;

  if (timerId !== null) {
    window.clearTimeout(timerId);
    timerId = null;
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }
  elements = null;
}

export default { startClock, stopClock, formatTime, formatSeconds, formatDate };
