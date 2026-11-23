/**
 * Luna · 应用入口
 * Step 1.1 只做两件事：初始化 storage、启动时钟。
 * 后续步骤的模块初始化在这里按序接入。
 */

import storage from './core/storage.js';
import ui from './ui.js';

/** 启动应用 */
function bootstrap() {
  try {
    const storageReady = storage.init();
    if (!storageReady && !storage.isAvailable()) {
      // localStorage 不可用（隐私模式等）：storage 已自动降级为内存存储，页面继续可用
      console.info('[main] localStorage 不可用，已降级为内存存储');
    }
  } catch (err) {
    console.error('[main] storage 初始化失败：', err);
  }

  try {
    ui.startClock();
  } catch (err) {
    console.error('[main] 时钟初始化失败：', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
