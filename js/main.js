/**
 * Luna · 应用入口
 * Step 1.1：初始化 storage、启动时钟
 * Step 1.2：恢复主题、休眠状态机、按钮交互、电量监听
 * Step 1.3-A：挂载宠物 SVG 三态造型（须早于休眠门，才能接住初始情绪事件）
 *
 * 初始化顺序有依赖：
 *   storage → 主题（避免闪白） → 时钟 → 宠物（先订阅 pet:mood-change）
 *   → 休眠门（启动即广播初始状态） → 按钮绑定 → 电量监听
 */

import storage from './core/storage.js';
import ui from './ui.js';
import pet from './pet.js';

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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
