/**
 * Luna · 应用入口
 * Step 1.1：初始化 storage、启动时钟
 * Step 1.2：恢复主题、休眠状态机、按钮交互、电量监听
 *
 * 初始化顺序有依赖：
 *   storage → 主题（避免闪白） → 时钟 → 休眠门（先订阅 power 事件）
 *   → 按钮绑定 → 电量监听（首次广播会被休眠门接住）
 */

import storage from './core/storage.js';
import ui from './ui.js';

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
