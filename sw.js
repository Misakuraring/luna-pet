/**
 * Luna · Service Worker
 * Step 1.4：离线缓存，保证断网状态下完整秒开。
 *
 * 约定：
 * - 全部资源使用相对路径，兼容 GitHub Pages 子路径部署（禁止 /xxx 根路径）
 * - install 预缓存核心资源 + skipWaiting
 * - activate 清理旧版本缓存 + clients.claim
 * - fetch 仅处理同源 GET，采用缓存优先（Cache-First）并回退网络
 *
 * 注意：本策略是缓存优先，**每次发布新版本必须改动 CACHE_NAME**（如 luna-pet-v1.0.1），
 * 否则老客户端会一直命中旧缓存，看不到更新。
 */

const CACHE_NAME = 'luna-pet-v1.0.1';

/** 核心静态资源（全部相对路径，作用于 sw 所在目录） */
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/main.js',
  './js/ui.js',
  './js/pet.js',
  './js/config.js',
  './js/core/storage.js',
  './js/core/eventBus.js',
  './js/core/loop.js',
  './assets/pet/idle.png',
  './assets/pet/happy.png',
  './assets/pet/sleep.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE_NAME);
        // 逐个 add：单个资源失败不会拖垮整次安装
        await Promise.all(
          PRECACHE_URLS.map(async (url) => {
            try {
              await cache.add(new Request(url, { cache: 'reload' }));
            } catch (err) {
              console.warn('[sw] 预缓存失败：' + url, err && err.message ? err.message : err);
            }
          })
        );
      } catch (err) {
        console.warn('[sw] 预缓存阶段异常：', err && err.message ? err.message : err);
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        );
      } catch (err) {
        console.warn('[sw] 清理旧缓存失败：', err && err.message ? err.message : err);
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // 只接管同源 GET 请求
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(handleFetch(request));
});

/**
 * 缓存优先，未命中再回退网络；网络成功则顺带写回缓存。
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function handleFetch(request) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;

    const response = await fetch(request);
    // 只缓存正常的同源响应（避免把 4xx/5xx 与 opaque 响应塞进缓存）
    if (response && response.ok && response.type === 'basic') {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    // 离线且未命中缓存：导航请求退回 index.html，其余返回简洁的 503
    if (request.mode === 'navigate') {
      const cache = await caches.open(CACHE_NAME);
      const fallback = await cache.match('./index.html', { ignoreSearch: true });
      if (fallback) return fallback;
    }
    return new Response('离线状态且该资源未缓存', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}
