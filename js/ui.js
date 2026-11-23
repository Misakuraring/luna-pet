/**
 * Luna · UI 层
 * Step 1.1：实时数字时钟 + 中文日期星期
 * Step 1.2：双主题切换与持久化、Battery Status API 检测、充电自动休眠 / 手动唤醒
 *
 * 约定（见 RULES.md）：
 * - 持久化一律走 ./core/storage.js，禁止自行读写 localStorage；
 * - 跨模块通知一律走 ./core/eventBus.js，事件名遵循「模块:动作」；
 * - 所有浏览器能力先做特性检测，失败只降级不抛错。
 */

import storage from './core/storage.js';
import eventBus from './core/eventBus.js';

/* ==========================================================================
   常量与工具
   ========================================================================== */

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

const THEME = { LIGHT: 'light', DARK: 'dark' };
const THEME_COLOR = { light: '#f7f5f2', dark: '#000000' };

const STATE = { IDLE: 'IDLE', SLEEP: 'SLEEP' };

const SELECTORS = {
  time: 'clock-time',
  seconds: 'clock-seconds',
  date: 'clock-date',
  battery: 'clock-battery',
  batteryText: 'clock-battery-text',
  batteryIcon: 'clock-battery-icon',
  stage: 'pet-stage',
  feedBtn: 'btn-feed',
  patBtn: 'btn-pat',
  themeBtn: 'btn-theme',
  sleepBtn: 'btn-sleep',
};

function pad2(value) {
  return String(value).padStart(2, '0');
}

function byId(id) {
  if (typeof document === 'undefined') return null;
  return document.getElementById(id);
}

/* ==========================================================================
   1. 主题（light / dark-OLED），持久化键 settings.theme
   ========================================================================== */

/** 把主题落到 <html data-theme> 上，并同步浏览器 UI 配色 */
export function applyTheme(theme) {
  if (typeof document === 'undefined') return THEME.LIGHT;

  const next = theme === THEME.DARK ? THEME.DARK : THEME.LIGHT;
  document.documentElement.dataset.theme = next;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[next]);

  return next;
}

/** 当前生效主题 */
export function getTheme() {
  if (typeof document === 'undefined') return THEME.LIGHT;
  return document.documentElement.dataset.theme === THEME.DARK ? THEME.DARK : THEME.LIGHT;
}

/** 启动时恢复上次主题（无记录则为 light） */
export function initTheme() {
  const saved = storage.get('settings.theme', THEME.LIGHT);
  return applyTheme(saved);
}

/**
 * 切换到另一个主题。
 * 只写 settings.theme 这一个叶子，绝不覆盖同级的 settings.renderMode。
 */
export function toggleTheme() {
  const next = getTheme() === THEME.DARK ? THEME.LIGHT : THEME.DARK;

  applyTheme(next);
  storage.set('settings.theme', next);
  eventBus.emit('system:theme-change', { theme: next });

  return next;
}

/* ==========================================================================
   2. 电池状态（Battery Status API）
   ========================================================================== */

const power = {
  supported: false,
  charging: false,
  level: null,
  manager: null,
};

/** 归一化电量：0~1 之间，不可用返回 null */
function normalizeLevel(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

function hideBattery() {
  const wrap = byId(SELECTORS.battery);
  if (wrap) wrap.hidden = true;
}

/** 电量渲染：百分比 = Math.round(level * 100) + '%'，充电时加 ⚡ 标识 */
function renderBattery() {
  const wrap = byId(SELECTORS.battery);
  if (!wrap) return;

  if (!power.supported || power.level === null) {
    wrap.hidden = true;
    return;
  }

  const text = byId(SELECTORS.batteryText);
  const icon = byId(SELECTORS.batteryIcon);
  const percent = `${Math.round(power.level * 100)}%`;

  wrap.hidden = false;
  wrap.dataset.charging = power.charging ? 'true' : 'false';
  wrap.setAttribute(
    'aria-label',
    power.charging ? `电量 ${percent}，充电中` : `电量 ${percent}`
  );

  if (text) text.textContent = percent;
  if (icon) icon.textContent = power.charging ? '⚡' : '🔋';
}

/** 广播当前电量状态（level 为 0~1，不支持时为 null） */
function publishPower() {
  renderBattery();
  eventBus.emit('system:power-change', {
    charging: power.charging,
    level: power.level,
  });
}

/**
 * 启动电量监听。返回 Promise<boolean>，表示是否拿到电池对象。
 * 局域网 HTTP 非安全上下文 / 接口缺失 / Promise 拒绝，一律静默隐藏电量区。
 */
export function startBatteryMonitor() {
  const unavailable = () => {
    power.supported = false;
    power.charging = false;
    power.level = null;
    hideBattery();

    // 同步一次「无电量信息」状态：level 为 null，充电状态按未知（false）处理
    eventBus.emit('system:power-change', { charging: false, level: null });
    return false;
  };

  if (
    typeof navigator === 'undefined' ||
    typeof navigator.getBattery !== 'function'
  ) {
    return Promise.resolve(unavailable());
  }

  // Promise.resolve().then 包裹：同步抛错也走 catch
  return Promise.resolve()
    .then(() => navigator.getBattery())
    .then((manager) => {
      if (!manager) throw new Error('empty battery manager');

      power.supported = true;
      power.manager = manager;
      power.charging = manager.charging === true;
      power.level = normalizeLevel(manager.level);

      const handleChange = () => {
        power.charging = manager.charging === true;
        power.level = normalizeLevel(manager.level);
        publishPower();
      };

      manager.addEventListener('chargingchange', handleChange);
      manager.addEventListener('levelchange', handleChange);

      // 首次拿到电池对象后立即广播一次初始状态
      publishPower();
      return true;
    })
    .catch((err) => {
      const reason = err && err.message ? err.message : String(err);
      console.info(`[ui] 电量信息不可用（非安全上下文属正常）：${reason}`);
      return unavailable();
    });
}

/* ==========================================================================
   3. 休眠状态机：手动意愿优先于充电自动休眠
   ========================================================================== */

const sleep = {
  manualSleep: false, // 用户手动意愿，落库到 pet.manualSleep
  charging: false, // 设备是否在充电
  wakeOverride: false, // 充电中被人为唤醒 → 本次充电周期内不再自动休眠
  state: STATE.IDLE,
  reason: null, // 'manual' | 'charging'
};

/** 计算当前应有的状态 */
function computeSleep() {
  if (sleep.manualSleep) return { state: STATE.SLEEP, reason: 'manual' };
  if (sleep.charging && !sleep.wakeOverride) return { state: STATE.SLEEP, reason: 'charging' };
  return { state: STATE.IDLE, reason: null };
}

/** 渲染舞台状态与按钮文案（台词气泡由 pet 模块自行处理） */
function renderSleep() {
  const stage = byId(SELECTORS.stage);
  const btn = byId(SELECTORS.sleepBtn);

  if (stage) stage.dataset.state = sleep.state;
  if (btn) btn.textContent = sleep.state === STATE.SLEEP ? '唤醒' : '休息';
}

/** 收敛状态并在变化时广播 pet:mood-change */
function publishSleep(force = false) {
  const next = computeSleep();
  const changed = force || next.state !== sleep.state || next.reason !== sleep.reason;

  sleep.state = next.state;
  sleep.reason = next.reason;
  renderSleep();

  if (changed) eventBus.emit('pet:mood-change', { state: next.state });
  return next.state;
}

/**
 * 初始化休眠状态机。
 * 必须在 startBatteryMonitor 之前调用，先订阅 system:power-change 才不会漏掉首次广播。
 */
export function startSleepGate() {
  sleep.manualSleep = storage.get('pet.manualSleep', false) === true;
  sleep.charging = false;
  sleep.wakeOverride = false;

  eventBus.on('system:power-change', (payload) => {
    const charging = Boolean(payload && payload.charging === true);
    const wasCharging = sleep.charging;

    sleep.charging = charging;

    // 拔线复位；插线（false → true）视为一次新的充电周期，重新触发自动休眠
    if (!charging) sleep.wakeOverride = false;
    if (charging && !wasCharging) sleep.wakeOverride = false;

    publishSleep();
  });

  return publishSleep(true);
}

/** 用户点击【休息 / 唤醒】 */
export function toggleSleep() {
  if (sleep.state === STATE.SLEEP) {
    // 唤醒：清手动意愿；若正在充电，用 wakeOverride 顶住自动休眠
    sleep.manualSleep = false;
    storage.set('pet.manualSleep', false);
    sleep.wakeOverride = sleep.charging === true;
  } else {
    // 休息：记录手动意愿，manualSleep 优先级最高
    sleep.manualSleep = true;
    storage.set('pet.manualSleep', true);
    sleep.wakeOverride = false;
  }

  return publishSleep(true);
}

/** 当前休眠状态（供后续步骤/调试） */
export function getSleepState() {
  return { state: sleep.state, reason: sleep.reason, charging: sleep.charging };
}

/* ==========================================================================
   4. 时钟
   ========================================================================== */

let timerId = null;
let clockElements = null;
let clockRunning = false;

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

function renderClock(now) {
  if (!clockElements) return;
  const date = now instanceof Date ? now : new Date();

  clockElements.time.textContent = formatTime(date);
  clockElements.seconds.textContent = formatSeconds(date);
  clockElements.date.textContent = formatDate(date);
}

/**
 * 按整秒对齐安排下一次刷新（setTimeout 而非 setInterval，
 * 休眠/卡顿回前台不会累积误差）。
 */
function scheduleNextTick() {
  if (!clockRunning) return;

  const delay = 1000 - new Date().getMilliseconds();
  timerId = window.setTimeout(() => {
    renderClock(new Date());
    scheduleNextTick();
  }, Math.max(delay, 50));
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') renderClock(new Date());
}

/** 启动时钟；DOM 缺失返回 false，不抛错 */
export function startClock() {
  if (clockRunning) return true;

  const time = byId(SELECTORS.time);
  const seconds = byId(SELECTORS.seconds);
  const date = byId(SELECTORS.date);

  if (!time || !seconds || !date) {
    console.warn('[ui] 未找到时钟节点，跳过时钟渲染');
    return false;
  }

  clockElements = { time, seconds, date };
  clockRunning = true;

  renderClock(new Date());
  scheduleNextTick();
  document.addEventListener('visibilitychange', handleVisibilityChange);

  return true;
}

/** 停止时钟并解绑监听 */
export function stopClock() {
  clockRunning = false;

  if (timerId !== null) {
    window.clearTimeout(timerId);
    timerId = null;
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }
  clockElements = null;
}

/* ==========================================================================
   5. 交互绑定
   ========================================================================== */

/**
 * 绑定四个按钮；单个 handler 抛错不影响其余按钮。
 * 投喂 / 摸头只广播 pet:interaction，绝不直接调用 pet 模块，避免模块耦合。
 */
export function initControls() {
  const feedBtn = byId(SELECTORS.feedBtn);
  const patBtn = byId(SELECTORS.patBtn);
  const themeBtn = byId(SELECTORS.themeBtn);
  const sleepBtn = byId(SELECTORS.sleepBtn);

  if (feedBtn) {
    feedBtn.addEventListener('click', () => {
      try {
        eventBus.emit('pet:interaction', { type: 'feed' });
      } catch (err) {
        console.error('[ui] 投喂交互广播失败：', err);
      }
    });
  }

  if (patBtn) {
    patBtn.addEventListener('click', () => {
      try {
        eventBus.emit('pet:interaction', { type: 'pet' });
      } catch (err) {
        console.error('[ui] 摸头交互广播失败：', err);
      }
    });
  }

  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      try {
        toggleTheme();
      } catch (err) {
        console.error('[ui] 主题切换失败：', err);
      }
    });
  }

  if (sleepBtn) {
    sleepBtn.addEventListener('click', () => {
      try {
        toggleSleep();
      } catch (err) {
        console.error('[ui] 休息/唤醒切换失败：', err);
      }
    });
  }

  return true;
}

export default {
  applyTheme,
  getTheme,
  initTheme,
  toggleTheme,
  startBatteryMonitor,
  startSleepGate,
  toggleSleep,
  getSleepState,
  startClock,
  stopClock,
  initControls,
  formatTime,
  formatSeconds,
  formatDate,
};
