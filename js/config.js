/**
 * Luna · 全局配置
 * 纯数据对象，不含任何函数与副作用；模块只读取，不修改。
 *
 * - renderMode：渲染模式，'svg' 为内联矢量（默认），'image' 为位图序列（预留）
 * - happyDurationMs：点击宠物进入 HAPPY 造型后的保持时长（毫秒）
 * - dialogues：台词库，Step 1.3-B 填充；本步保持空结构，避免抢跑
 */

export const PET_CONFIG = {
  renderMode: 'svg',
  happyDurationMs: 2500,
  dialogues: {
    idle: [],
    happy: [],
    sleep: [],
  },
};

export default PET_CONFIG;
