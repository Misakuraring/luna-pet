/**
 * Luna · 应用入口
 * Step 1.1：初始化 storage、启动时钟
 * Step 1.2：恢复主题、休眠状态机、按钮交互、电量监听
 * Step 1.3-A：挂载 Luna 三态造型（须早于休眠门，才能接住初始情绪事件）
 * Step 1.3-B：立绘改为透明底 PNG 位图渲染，加入台词气泡与 Pointer Events
 * Step 1.3-C：启动统一的 rAF 主循环（全应用仅此一个，跟着页面可见性暂停/恢复）
 * Step 1.4：安全上下文下注册 Service Worker（离线缓存），非安全上下文静默跳过
 *
 * 初始化顺序有依赖：
 *   storage → 主题（避免闪白） → 时钟 → 宠物（先订阅 pet:mood-change）
 *   → 主循环（宠物已注册 onTick，启动后立刻开始派帧）
 *   → 休眠门（启动即广播初始状态） → 按钮绑定 → 电量监听
 */

import storage from './core/storage.js';
import ui from './ui.js';
import pet from './pet.js';
import loop from './core/loop.js';

function bootstrap() {
  try {
    const initialized = storage.init();
    if (!initialized && !storage.isAvailable()) {
      // localStorage 不可用（隐私模式等）：storage 已降级为内存存储，页面照常可用
      console.info('[main] localStorage 不可用，已降级为内存存储');
    }
  } catch (err) {
    console.error('[main] storage 初始化失败：', err);
  }

  try {
    ui.initTheme();
  } catch (err) {
    console.error('[main] 主题初始化失败：', err);
  }

  try {
    ui.startClock();
  } catch (err) {
    console.error('[main] 时钟初始化失败：', err);
  }

  try {
    // 必须在休眠门之前：休眠门启动时会立刻广播一次 pet:mood-change
    pet.initPet();
  } catch (err) {
    console.error('[main] 宠物模块初始化失败：', err);
  }

  try {
    // 统一主循环：全应用唯一，内部按 document.hidden 自动暂停/恢复
    loop.startLoop();
  } catch (err) {
    console.error('[main] 主循环初始化失败：', err);
  }

  try {
    ui.startSleepGate();
  } catch (err) {
    console.error('[main] 休眠状态初始化失败：', err);
  }

  try {
    ui.initControls();
  } catch (err) {
    console.error('[main] 交互绑定失败：', err);
  }

  try {
    // 自身已内部 catch，返回 Promise 仅用于观测结果
    Promise.resolve(ui.startBatteryMonitor()).catch((err) => {
      console.info('[main] 电量监听降级：', err && err.message ? err.message : err);
    });
  } catch (err) {
    console.info('[main] 电量监听不可用：', err);
  }

  registerServiceWorker();
}

/**
 * 安全地注册 Service Worker。
 * - 不支持该 API：仅 console.info
 * - 非安全上下文（如局域网 http://192.168.x.x:8000）：仅 console.info 并跳过，
 *   不产生任何红色报错；PWA 安装与离线缓存需改用 https 或 localhost
 */
function registerServiceWorker() {
  // 先判安全上下文：局域网 http://192.168.x.x 下 navigator.serviceWorker 本身就不存在，
  // 先判这一条才能给出准确的提示，而不是误报“环境不支持”
  if (!window.isSecureContext) {
    console.info(
      '[main] 当前为非安全上下文（局域网 HTTP），Service Worker 与 PWA 安装能力受限，已跳过注册；' +
        '用 https 或 localhost 访问即自动启用离线缓存'
    );
    return;
  }
  if (!('serviceWorker' in navigator)) {
    console.info('[main] 当前环境不支持 Service Worker，已跳过离线缓存注册');
    return;
  }
  try {
    const registering = navigator.serviceWorker.register('./sw.js', { scope: './' });
    Promise.resolve(registering)
      .then((registration) => {
        console.info('[main] Service Worker 已注册，作用域：' + registration.scope);
      })
      .catch((err) => {
        console.info('[main] Service Worker 注册失败：', err && err.message ? err.message : err);
      });
  } catch (err) {
    console.info('[main] Service Worker 注册被中断：', err && err.message ? err.message : err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
