self.addEventListener('fetch', (event) => {
    if (
        event.request.mode !== 'navigate' ||
        event.request.method !== 'GET' ||
        new URL(event.request.url).origin !== self.location.origin
    ) {
        return;
    }
    event.respondWith(
        fetch(event.request).catch(() =>
            new Response(
                '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>云手机离线</title><main><h1>无法连接云手机</h1><p>检查是否已连接到飞牛所在的网络，然后刷新重试。</p></main></html>',
                { status: 503, headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-store' } },
            ),
        ),
    );
});
