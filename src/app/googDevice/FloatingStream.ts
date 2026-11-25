interface PictureInPictureController {
    window: Window | null;
    requestWindow(options: { width: number; height: number }): Promise<Window>;
}

let viewer: Window | null;
let floatingFrame: HTMLIFrameElement | undefined;
let restoreViewer: (() => void) | undefined;
const toggleEvent = 'ws-scrcpy-toggle-preview';
const closeEvent = 'ws-scrcpy-hide-floating-window';

function onShortcut(event: KeyboardEvent, toggle: () => void): void {
    if (event.key !== 'F8' || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    toggle();
}

export function addCompactMode(): void {
    document.body.classList.add('compact-stream');
    const veil = document.createElement('button');
    veil.className = 'compact-veil';
    veil.textContent = '画面已隐藏 · 按 F8 或点击恢复';
    veil.hidden = true;
    const toggle = () => {
        const view = document.querySelector<HTMLElement>('.device-view');
        veil.hidden = !veil.hidden;
        if (view) {
            view.hidden = !veil.hidden;
        }
        if (!veil.hidden) {
            veil.focus();
        } else {
            view?.focus();
        }
    };
    veil.onclick = toggle;
    document.body.append(veil);
    window.addEventListener(toggleEvent, toggle);
    window.addEventListener(
        'keydown',
        (event) =>
            onShortcut(event, () => {
                if (window.parent !== window) {
                    const close = new Event(closeEvent, { cancelable: true });
                    if (!window.parent.dispatchEvent(close)) {
                        return;
                    }
                }
                toggle();
            }),
        true,
    );
    window.addEventListener(
        'keyup',
        (event) => {
            if (event.key === 'F8') {
                event.stopImmediatePropagation();
            }
        },
        true,
    );
}

export function createFloatingLink(streamUrl: URL, landscape: boolean): HTMLAnchorElement {
    streamUrl.searchParams.set('compact', '1');
    const link = document.createElement('a');
    link.className = 'floating-stream';
    link.href = streamUrl.href;
    link.textContent = '悬浮窗';
    link.target = '_blank';
    link.rel = 'noopener';
    link.addEventListener('click', (event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
            return;
        }
        event.preventDefault();
        const width = landscape ? 440 : 310;
        const height = landscape ? 310 : 570;
        const popup = () => {
            const opened = window.open(streamUrl, 'ws-scrcpy-floating', `popup,width=${width},height=${height}`);
            if (opened) {
                viewer = opened;
                opened.focus();
            } else {
                link.textContent = '允许弹窗后重试';
            }
        };
        const pip = (window as Window & { documentPictureInPicture?: PictureInPictureController })
            .documentPictureInPicture;
        if (viewer && !viewer.closed) {
            if (floatingFrame) {
                if (floatingFrame.src !== streamUrl.href) {
                    floatingFrame.src = streamUrl.href;
                }
                viewer.focus();
            } else {
                popup();
            }
            return;
        }
        link.textContent = '悬浮窗';
        if (!pip || streamUrl.origin !== location.origin) {
            popup();
            return;
        }
        const openFloating = () => {
            restoreViewer = undefined;
            void pip.requestWindow({ width, height }).then((floating) => {
                viewer = floating;
                floating.document.title = '云手机小窗';
                floating.document.body.style.cssText = 'margin:0;background:#101724;height:100vh;overflow:hidden';
                const frame = (floatingFrame = floating.document.createElement('iframe'));
                frame.src = streamUrl.href;
                frame.title = '云手机小窗';
                frame.allowFullscreen = true;
                frame.style.cssText = 'display:block;width:100%;height:100%;border:0';
                floating.document.body.append(frame);
                const hide = () => {
                    const currentUrl = frame.src;
                    restoreViewer = () => {
                        streamUrl.href = currentUrl;
                        openFloating();
                    };
                    floating.close();
                    window.focus();
                };
                floating.addEventListener(closeEvent, (close) => {
                    close.preventDefault();
                    hide();
                });
                floating.addEventListener('keydown', (key) => onShortcut(key, hide), true);
                floating.addEventListener('pagehide', () => {
                    if (viewer === floating) {
                        floatingFrame = undefined;
                        viewer = null;
                    }
                });
            }, popup);
        };
        openFloating();
    });
    return link;
}

function toggleViewer(): void {
    try {
        const target = floatingFrame?.contentWindow ?? viewer;
        target?.dispatchEvent(new Event(toggleEvent));
    } catch {
        return;
    }
}

export function bindFloatingShortcut(): void {
    window.addEventListener(
        'keydown',
        (event) => {
            if (viewer && !viewer.closed) {
                onShortcut(event, () => {
                    if (floatingFrame) {
                        viewer?.dispatchEvent(new Event(closeEvent, { cancelable: true }));
                    } else {
                        toggleViewer();
                    }
                });
            } else if (restoreViewer) {
                onShortcut(event, restoreViewer);
            }
        },
        true,
    );
}
