interface InstallPrompt extends Event {
    prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let pendingPrompt: InstallPrompt | undefined;

export function isAppMode(): boolean {
    const device = navigator as Navigator & { standalone?: boolean };
    return Boolean(device.standalone || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches);
}

export function startPwa(): void {
    if (!window.isSecureContext || window.top !== window) {
        return;
    }
    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        pendingPrompt = event as InstallPrompt;
    });
    if ('serviceWorker' in navigator) {
        void navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('无法注册应用模式', error));
    }
}

export function createInstallGuide(): HTMLElement {
    const guide = document.createElement('details');
    guide.className = 'install-guide';
    guide.hidden = isAppMode();
    const summary = document.createElement('summary');
    summary.textContent = '安装应用';
    const instructions = document.createElement('p');
    instructions.textContent = !window.isSecureContext
        ? '请先信任飞牛的 HTTPS 证书。只跳过浏览器证书警告不会启用应用安装。'
        : 'Android：浏览器菜单 → 安装应用。iPhone / iPad：Safari 分享 → 添加到主屏幕，并开启「作为网页 App 打开」（若有此选项）。';
    guide.append(summary, instructions);
    summary.onclick = (event) => {
        if (pendingPrompt) {
            event.preventDefault();
            const prompt = pendingPrompt;
            pendingPrompt = undefined;
            void prompt
                .prompt()
                .then(({ outcome }) => {
                    if (outcome === 'accepted') {
                        guide.hidden = true;
                    }
                })
                .catch(() => {
                    guide.open = true;
                });
        }
    };
    window.addEventListener('appinstalled', () => {
        guide.hidden = true;
    });
    return guide;
}
