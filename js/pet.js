/**
 * Luna · 宠物模块（Step 1.3-B：位图渲染 + 对话气泡 + Pointer Events 状态机）
 *
 * 设计约定：
 *   1. 立绘为预处理后的透明底 PNG（512×512，三态同画布同基准），用 <img> 渲染，
 *      挂载时预加载全部三态，切换只改 src 与容器 data-mood，不重建 DOM；
 *   2. 交互统一走 eventBus：外部按钮 → 'pet:interaction'，本模块只订阅不关心来源，
 *      状态变化再广播 'pet:mood-change'（不直接调用 ui.js）；
 *   3. 轻点用 pointerdown/pointerup 判定「位移 < 10px」，pointercancel 必须清理按下态；
 *      tapCooldownMs 只限制异常高频连点，不做会吞掉最后一次点击的防抖；
 *   4. 所有定时器都是单例：恢复计时器、气泡计时器、微动反馈计时器，
 *      每次触发先清旧的再设新的，绝不并行。
 *
 * 对外接口：
 *   initPet()            → 挂载立绘与气泡、绑定事件，返回是否成功
 *   setMood(m)           → 直接设定造型（'IDLE' | 'HAPPY' | 'SLEEP'），返回生效值
 *   playHappy(type)      → 非 SLEEP 时切 HAPPY + 气泡，happyDurationMs 后回落 IDLE
 *   showBubble(text)     → 手动弹一条气泡（供调试/后续步骤复用）
 *   getPetRuntime()      → 帧循环联动统计（只读快照）
 *   MOOD                 → 造型常量
 *
 * Step 1.3-C 追加：
 *   - 向 js/core/loop.js 注册轻量 onTick 钩子，仅做帧计数与 dt 观测，
 *     不接管三态 CSS 动画，也不介入交互状态机；
 *   - 页面从后台恢复时重建计时基准（死线比对），把过期未触发的恢复计时器、
 *     气泡计时器和残留按下态一次性收敛，避免卡在 HAPPY / 气泡常显等中间态。
 */

import { PET_CONFIG } from './config.js';
import eventBus from './core/eventBus.js';
import { onTick, getLoopStats } from './core/loop.js';

export const MOOD = {
  IDLE: 'IDLE',
  HAPPY: 'HAPPY',
  SLEEP: 'SLEEP',
};

const CONTAINER_ID = 'luna-pet';
const BUBBLE_ID = 'luna-bubble';
const BUBBLE_TEXT_ID = 'luna-bubble-text';

/** 有效轻点的最大位移（px） */
const TAP_MAX_DISTANCE = 10;

/** 允许的交互类型（与 config.dialogues 的键一致） */
const INTERACTION_TYPES = ['tap', 'feed', 'pet'];

/* --------------------------------------------------------------------------
   状态
   -------------------------------------------------------------------------- */

let container = null;
let imageEl = null;
let bubbleEl = null;
let bubbleTextEl = null;

let mood = MOOD.IDLE;
/** 外部（ui.js 休眠状态机）推来的状态，用于识别 SLEEP → IDLE 的唤醒瞬间 */
let externalMood = MOOD.IDLE;

let happyTimer = null;
let bubbleTimer = null;
let microTimer = null;

/** 计时死线（绝对时间戳）：页面切后台再回来时用来判断"本该已经到点" */
let happyDeadline = 0;
let bubbleDeadline = 0;

/** 主循环联动统计（只读观测，不参与造型逻辑） */
const runtime = {
  ticks: 0,
  elapsed: 0,
  lastDt: 0,
  reconciles: 0,
  ticked: false,
};
let unsubscribeTick = null;

/** 按下追踪：只有同一 pointerId 的 pointerup 才算数 */
let pointerTrack = null;
let lastTapAt = 0;

/** 每条台词类型上一次用过的句子，避免连续重复 */
const lastLine = {
  tap: '',
  feed: '',
  pet: '',
  sleep: '',
  wake: '',
};

/** 图片资源是否加载完成（避免切换瞬间闪白） */
const imageState = {
  IDLE: false,
  HAPPY: false,
  SLEEP: false,
};
const preloaded = {};

/* --------------------------------------------------------------------------
   工具
   -------------------------------------------------------------------------- */

function isValidMood(value) {
  return value === MOOD.IDLE || value === MOOD.HAPPY || value === MOOD.SLEEP;
}

function safeClear(timerId) {
  if (timerId !== null) {
    clearTimeout(timerId);
    return null;
  }
  return null;
}

/** 从台词库随机抽一句，尽量不与上一次重复 */
function pickLine(type) {
  const pool = PET_CONFIG.dialogues && PET_CONFIG.dialogues[type];
  if (!Array.isArray(pool) || pool.length === 0) return '';
  if (pool.length === 1) return pool[0];

  const candidates = pool.filter((line) => line !== lastLine[type]);
  const source = candidates.length > 0 ? candidates : pool;
  const text = source[Math.floor(Math.random() * source.length)] || '';
  lastLine[type] = text;
  return text;
}

/* --------------------------------------------------------------------------
   造型
   -------------------------------------------------------------------------- */

function applyMood(next) {
  const safe = isValidMood(next) ? next : MOOD.IDLE;
  mood = safe;

  if (container) container.dataset.mood = safe;

  if (imageEl) {
    const src = PET_CONFIG.images && PET_CONFIG.images[safe];
    // 图片已预加载成功才切；未就绪时保持当前帧，避免出现空白
    if (src && imageState[safe]) {
      if (imageEl.getAttribute('src') !== src) imageEl.setAttribute('src', src);
    } else if (src && !imageEl.getAttribute('src')) {
      imageEl.setAttribute('src', src);
    }
  }

  return mood;
}

/** 直接设定造型，返回实际生效值 */
export function setMood(next) {
  happyTimer = safeClear(happyTimer);
  happyDeadline = 0;
  return applyMood(next);
}

/* --------------------------------------------------------------------------
   气泡
   -------------------------------------------------------------------------- */

/** 弹出一条气泡，bubbleDurationMs 后自动淡出 */
export function showBubble(text) {
  if (!bubbleEl || !bubbleTextEl) return false;

  const line = typeof text === 'string' ? text.trim() : '';
  if (!line) return false;

  bubbleTextEl.textContent = line;

  // 同一条气泡连发时重新播放过渡：先移除类再强制回流，避免动画不重启
  bubbleEl.classList.remove('is-visible');
  void bubbleEl.offsetWidth;
  bubbleEl.classList.add('is-visible');
  bubbleEl.setAttribute('aria-hidden', 'false');

  bubbleTimer = safeClear(bubbleTimer);
  bubbleDeadline = Date.now() + PET_CONFIG.bubbleDurationMs;
  bubbleTimer = setTimeout(() => {
    bubbleTimer = null;
    bubbleDeadline = 0;
    hideBubble();
  }, PET_CONFIG.bubbleDurationMs);

  return true;
}

/** 立即淡出气泡 */
export function hideBubble() {
  bubbleTimer = safeClear(bubbleTimer);
  bubbleDeadline = 0;
  if (!bubbleEl) return;
  bubbleEl.classList.remove('is-visible');
  bubbleEl.setAttribute('aria-hidden', 'true');
}

/* --------------------------------------------------------------------------
   微动反馈（不新建并行动画循环，单例定时器到点移除类名）
   -------------------------------------------------------------------------- */

function playMicroFeedback(kind) {
  if (!container) return;
  container.classList.remove('is-bump', 'is-nudge');
  void container.offsetWidth;
  container.classList.add(kind === 'nudge' ? 'is-nudge' : 'is-bump');

  microTimer = safeClear(microTimer);
  microTimer = setTimeout(() => {
    microTimer = null;
    if (container) container.classList.remove('is-bump', 'is-nudge');
  }, 420);
}

/* --------------------------------------------------------------------------
   交互状态机
   -------------------------------------------------------------------------- */

/**
 * 统一交互入口。
 * 非 SLEEP：切 HAPPY + 对应台词 + 广播 pet:mood-change，重置单一恢复计时器；
 * SLEEP：造型不变，只弹梦话气泡并轻微点头。
 */
export function playHappy(type = 'tap') {
  const kind = INTERACTION_TYPES.includes(type) ? type : 'tap';
  if (!container) return false;

  if (mood === MOOD.SLEEP) {
    // 休眠不被打断：只出梦话，不切造型、不发 mood-change
    const sleepLine = pickLine('sleep');
    if (sleepLine) showBubble(sleepLine);
    playMicroFeedback('nudge');
    return 'SLEEP';
  }

  const text = pickLine(kind);

  happyTimer = safeClear(happyTimer);
  applyMood(MOOD.HAPPY);
  playMicroFeedback('bump');
  if (text) showBubble(text);

  eventBus.emit('pet:mood-change', { state: MOOD.HAPPY, text });

  happyDeadline = Date.now() + PET_CONFIG.happyDurationMs;
  happyTimer = setTimeout(() => {
    happyTimer = null;
    happyDeadline = 0;
    if (mood === MOOD.HAPPY) applyMood(MOOD.IDLE);
  }, PET_CONFIG.happyDurationMs);

  return 'HAPPY';
}

/** 外部交互事件（按钮点击统一走 eventBus，不直接调用本模块） */
function handleInteraction(payload) {
  const type = payload && typeof payload === 'object' ? payload.type : null;
  if (!INTERACTION_TYPES.includes(type)) {
    if (type !== undefined && type !== null) {
      console.warn('[pet] 未知交互类型：' + String(type));
    }
    return;
  }
  playHappy(type);
}

/** 外部情绪事件（来自 ui.js 的休眠状态机） */
function handleMoodChange(payload) {
  const state = payload && typeof payload === 'object' ? payload.state : null;

  if (state === 'SLEEP') {
    externalMood = MOOD.SLEEP;
    happyTimer = safeClear(happyTimer);
    happyDeadline = 0;
    hideBubble();
    applyMood(MOOD.SLEEP);
    return;
  }

  if (state === 'IDLE') {
    const wasSleeping = externalMood === MOOD.SLEEP;
    externalMood = MOOD.IDLE;
    happyTimer = safeClear(happyTimer);
    happyDeadline = 0;
    applyMood(MOOD.IDLE);

    // 只在真正从 SLEEP 醒来的那一刻问好，启动时的首次 IDLE 不乱说话
    if (wasSleeping) {
      const wakeLine = pickLine('wake');
      if (wakeLine) showBubble(wakeLine);
    }
  }
}

/* --------------------------------------------------------------------------
   Pointer Events
   -------------------------------------------------------------------------- */

function handlePointerDown(event) {
  if (!event || event.isPrimary === false) return;
  pointerTrack = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    at: Date.now(),
  };
}

function handlePointerUp(event) {
  if (!event || !pointerTrack) return;
  if (event.pointerId !== pointerTrack.id) return;

  const { x, y } = pointerTrack;
  pointerTrack = null;

  const moved = Math.hypot(event.clientX - x, event.clientY - y);
  if (moved >= TAP_MAX_DISTANCE) return; // 拖动/滑动不算轻点

  // 冷却：只丢弃过于密集的连点，点击一旦通过就立即生效
  const now = Date.now();
  if (now - lastTapAt < PET_CONFIG.tapCooldownMs) return;
  lastTapAt = now;

  playHappy('tap');
}

function handlePointerCancel(event) {
  // 触控被打断（来电、手势抢占）：必须清掉按下态，否则后续 pointerup 全部错位
  if (!pointerTrack) return;
  if (event && event.pointerId !== undefined && event.pointerId !== pointerTrack.id) return;
  pointerTrack = null;
}

/* --------------------------------------------------------------------------
   主循环联动与前后台生命周期（Step 1.3-C）
   -------------------------------------------------------------------------- */

/**
 * 从后台恢复后的收敛。
 * 浏览器在后台会节流甚至冻结 setTimeout，恢复时若死线已过，
 * 立即结束到期状态，避免卡在 HAPPY / 气泡常显 / 半截微动动画。
 */
function reconcileAfterResume() {
  runtime.reconciles += 1;

  // 后台期间可能丢失 pointerup / pointercancel，残留按下态会让下一次轻点错位
  pointerTrack = null;

  const t = Date.now();

  if (happyTimer !== null && happyDeadline !== 0 && t >= happyDeadline) {
    happyTimer = safeClear(happyTimer);
    happyDeadline = 0;
    if (mood === MOOD.HAPPY && externalMood !== MOOD.SLEEP) applyMood(MOOD.IDLE);
  }

  if (bubbleTimer !== null && bubbleDeadline !== 0 && t >= bubbleDeadline) {
    hideBubble();
  }

  microTimer = safeClear(microTimer);
  if (container) container.classList.remove('is-bump', 'is-nudge');
}

/** 每帧钩子：只做观测统计，不改造型、不接管三态 CSS 动画 */
function handleTick(dt) {
  runtime.ticks += 1;
  runtime.elapsed += dt;
  runtime.lastDt = dt;
  runtime.ticked = true;
}

function handlePetVisibility() {
  if (typeof document === 'undefined' || document.hidden === true) return;
  reconcileAfterResume();
}

/** 帧循环联动统计（只读快照） */
export function getPetRuntime() {
  const loop = getLoopStats();
  return {
    mood,
    externalMood,
    ticks: runtime.ticks,
    elapsed: Math.round(runtime.elapsed * 1000) / 1000,
    lastDt: runtime.lastDt,
    reconciles: runtime.reconciles,
    tickSubscribed: typeof unsubscribeTick === 'function',
    loop: {
      running: loop.running,
      paused: loop.paused,
      frames: loop.frames,
      fps: loop.fps,
      pauses: loop.pauses,
      resumes: loop.resumes,
      clampedFrames: loop.clampedFrames,
    },
  };
}

/* --------------------------------------------------------------------------
   挂载
   -------------------------------------------------------------------------- */

/** 预加载三态立绘：成功记录状态，失败只提示不抛错 */
function preloadImages() {
  const images = PET_CONFIG.images || {};
  return Promise.all(
    Object.keys(images).map(
      (key) =>
        new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            imageState[key] = true;
            preloaded[key] = img;
            // 回补：冷启动时 mood 可能早于预加载完成就已切到 SLEEP/HAPPY，
            // 这里在图片就绪的瞬间把当前造型重新应用一次，避免停留旧立绘
            if (mood === key) {
              try {
                applyMood(mood);
              } catch (err) {
                console.error('[pet] 预加载回补造型失败：', err);
              }
            }
            resolve(true);
          };
          img.onerror = () => {
            imageState[key] = false;
            console.warn('[pet] 立绘加载失败：' + images[key]);
            resolve(false);
          };
          img.src = images[key];
        })
    )
  );
}

function createImageElement() {
  const img = document.createElement('img');
  img.className = 'pet__img';
  img.alt = 'Luna，星光紫蓝渐变猫娘桌宠';
  img.decoding = 'async';
  img.draggable = false;
  img.addEventListener('error', () => {
    console.warn('[pet] 立绘渲染失败，已回退为占位提示');
    if (container) container.dataset.broken = 'true';
  });
  return img;
}

function mount() {
  if (container) return true;

  container = document.getElementById(CONTAINER_ID);
  if (!container) {
    console.warn('[pet] 未找到宠物容器 #' + CONTAINER_ID);
    return false;
  }

  bubbleEl = document.getElementById(BUBBLE_ID);
  bubbleTextEl = document.getElementById(BUBBLE_TEXT_ID);

  if (PET_CONFIG.renderMode === 'svg') {
    console.info('[pet] renderMode=svg 已废弃，请使用预处理的 image 立绘');
  }

  imageEl = createImageElement();
  const firstSrc = PET_CONFIG.images && PET_CONFIG.images[MOOD.IDLE];
  if (firstSrc) imageEl.setAttribute('src', firstSrc);

  container.textContent = '';
  container.appendChild(imageEl);
  applyMood(MOOD.IDLE);

  // 预加载其余两态，切换时不闪白
  Promise.resolve()
    .then(() => preloadImages())
    .then((flags) => {
      if (Array.isArray(flags) && flags.some((ok) => ok === false)) {
        console.info('[pet] 部分立绘不可用，将回退到已加载的帧');
      }
    })
    .catch((err) => {
      console.warn('[pet] 立绘预加载异常：' + (err && err.message ? err.message : String(err)));
    });

  return true;
}

/** 初始化宠物模块：挂载立绘与气泡 + 绑定事件 */
export function initPet() {
  if (!mount()) return false;

  eventBus.on('pet:interaction', handleInteraction);
  eventBus.on('pet:mood-change', handleMoodChange);

  if (typeof container.addEventListener === 'function') {
    container.addEventListener('pointerdown', handlePointerDown);
    container.addEventListener('pointerup', handlePointerUp);
    container.addEventListener('pointercancel', handlePointerCancel);
    // 部分浏览器在 pointerup 前触发 pointerleave（手指滑出元素），一并清理
    container.addEventListener('pointerleave', handlePointerCancel);
  }

  // 接入统一主循环：只挂一个观测钩子，重复初始化不会重复订阅
  if (typeof unsubscribeTick !== 'function') {
    unsubscribeTick = onTick(handleTick);
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', handlePetVisibility);
  }

  return true;
}

export default { MOOD, initPet, setMood, playHappy, showBubble, hideBubble, getPetRuntime };
