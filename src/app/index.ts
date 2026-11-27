import '../style/app.css';
import { StreamClientScrcpy } from './googDevice/client/StreamClientScrcpy';
import { HostTracker } from './client/HostTracker';
import { Tool } from './client/Tool';
import { addCompactMode, bindFloatingShortcut } from './googDevice/FloatingStream';
import { createInstallGuide, startPwa } from './Pwa';
import { DeviceReadiness } from '../common/DeviceReadiness';

startPwa();

const readinessMessages: Record<DeviceReadiness, string> = {
    adb_unavailable: '网页服务在线 · ADB 暂不可用',
    no_device: 'ADB 在线 · 未连接可用的 Android 设备',
    scrcpy_not_running: 'Android 已连接 · 投屏服务尚未就绪',
    ready: '投屏服务已启动 · 选择 Android 设备开始投屏',
};

function showDeviceReadiness(summary: HTMLElement, tracker: HostTracker): void {
    let hosts: number | undefined;
    let trackerDisconnected = false;
    let sessionExpired = false;
    let readiness: DeviceReadiness | undefined;
    const render = () => {
        if (!document.body.classList.contains('dashboard')) {
            return;
        }
        if (sessionExpired) {
            summary.textContent = '登录已失效，请刷新页面重新登录';
        } else if (trackerDisconnected) {
            const detail = readiness ? readinessMessages[readiness] : '设备列表连接已断开';
            summary.textContent = readiness ? `${detail} · 设备列表正在重连…` : '设备列表连接已断开，正在重连…';
        } else if (hosts === undefined) {
            summary.textContent = readinessMessages[readiness ?? 'adb_unavailable'];
        } else {
            const hostStatus = hosts ? '选择设备开始投屏' : '没有可用的设备服务';
            summary.textContent = readiness ? readinessMessages[readiness] : hostStatus;
        }
    };
    tracker.on('hosts', (count) => {
        hosts = count;
        trackerDisconnected = false;
        render();
    });
    tracker.on('disconnected', () => {
        trackerDisconnected = true;
        render();
    });

    const refresh = async () => {
        if (!document.body.classList.contains('dashboard')) {
            return;
        }
        const request = new AbortController();
        const timeout = window.setTimeout(() => request.abort(), 4000);
        try {
            if (document.visibilityState === 'visible') {
                const response = await fetch('readyz', {
                    cache: 'no-store',
                    redirect: 'error',
                    signal: request.signal,
                });
                if (response.status === 200 || response.status === 503) {
                    const result: { status?: DeviceReadiness } = await response.json();
                    readiness = result.status;
                    render();
                } else if (response.status === 404) {
                    return;
                } else if (response.status === 401) {
                    if (document.body.classList.contains('dashboard') && !sessionExpired) {
                        sessionExpired = true;
                        tracker.destroy();
                        render();
                    }
                    return;
                }
            }
        } catch {
            readiness = undefined;
            if (hosts !== undefined || trackerDisconnected) {
                render();
            }
        } finally {
            window.clearTimeout(timeout);
        }
        window.setTimeout(refresh, 5000);
    };
    void refresh();
}

window.onload = async function (): Promise<void> {
    const hash = location.hash.replace(/^#!/, '');
    const parsedQuery = new URLSearchParams(hash);
    const action = parsedQuery.get('action');

    const udid = parsedQuery.get('udid');
    if (action === StreamClientScrcpy.ACTION && udid !== null) {
        const player = await StreamClientScrcpy.loadPlayer(udid, parsedQuery.get('player'));
        if (!player) {
            const status = document.createElement('div');
            status.className = 'stream-status';
            status.setAttribute('role', 'status');
            const message = document.createElement('p');
            message.textContent = '无法加载可用的播放器。';
            const back = document.createElement('a');
            back.href = location.pathname;
            back.textContent = '返回设备列表';
            status.append(message, back);
            document.body.append(status);
            return;
        }
        parsedQuery.set('player', player.playerCodeName);
        StreamClientScrcpy.start(parsedQuery);
        if (new URLSearchParams(location.search).get('compact') === '1') {
            addCompactMode();
        }
        return;
    }

    /// #if INCLUDE_APPL
    {
        const { DeviceTracker } = await import('./applDevice/client/DeviceTracker');

        /// #if USE_QVH_SERVER
        const { StreamClientQVHack } = await import('./applDevice/client/StreamClientQVHack');

        DeviceTracker.registerTool(StreamClientQVHack);

        /// #if USE_WEBCODECS
        const { WebCodecsPlayer } = await import('./player/WebCodecsPlayer');
        StreamClientQVHack.registerPlayer(WebCodecsPlayer);
        /// #endif

        /// #if USE_H264_CONVERTER
        const { MsePlayerForQVHack } = await import('./player/MsePlayerForQVHack');
        StreamClientQVHack.registerPlayer(MsePlayerForQVHack);
        /// #endif

        if (action === StreamClientQVHack.ACTION && typeof parsedQuery.get('udid') === 'string') {
            StreamClientQVHack.start(StreamClientQVHack.parseParameters(parsedQuery));
            return;
        }
        /// #endif

        /// #if USE_WDA_MJPEG_SERVER
        const { StreamClientMJPEG } = await import('./applDevice/client/StreamClientMJPEG');
        DeviceTracker.registerTool(StreamClientMJPEG);

        const { MjpegPlayer } = await import('./player/MjpegPlayer');
        StreamClientMJPEG.registerPlayer(MjpegPlayer);

        if (action === StreamClientMJPEG.ACTION && typeof parsedQuery.get('udid') === 'string') {
            StreamClientMJPEG.start(StreamClientMJPEG.parseParameters(parsedQuery));
            return;
        }
        /// #endif
    }
    /// #endif

    const tools: Tool[] = [];

    /// #if INCLUDE_ADB_SHELL
    const { ShellClient } = await import('./googDevice/client/ShellClient');
    if (action === ShellClient.ACTION && typeof parsedQuery.get('udid') === 'string') {
        ShellClient.start(ShellClient.parseParameters(parsedQuery));
        return;
    }
    tools.push(ShellClient);
    /// #endif

    /// #if INCLUDE_DEV_TOOLS
    const { DevtoolsClient } = await import('./googDevice/client/DevtoolsClient');
    if (action === DevtoolsClient.ACTION) {
        DevtoolsClient.start(DevtoolsClient.parseParameters(parsedQuery));
        return;
    }
    tools.push(DevtoolsClient);
    /// #endif

    /// #if INCLUDE_FILE_LISTING
    const { FileListingClient } = await import('./googDevice/client/FileListingClient');
    if (action === FileListingClient.ACTION) {
        FileListingClient.start(FileListingClient.parseParameters(parsedQuery));
        return;
    }
    tools.push(FileListingClient);
    /// #endif

    if (tools.length) {
        const { DeviceTracker } = await import('./googDevice/client/DeviceTracker');
        tools.forEach((tool) => {
            DeviceTracker.registerTool(tool);
        });
    }
    document.body.classList.add('dashboard');
    bindFloatingShortcut();
    const header = document.createElement('header');
    header.className = 'dashboard-header';
    const titleRow = document.createElement('div');
    titleRow.className = 'dashboard-title-row';
    const logo = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    logo.setAttribute('viewBox', '0 0 20 24');
    logo.setAttribute('aria-hidden', 'true');
    logo.setAttribute('fill', 'none');
    logo.setAttribute('stroke', 'currentColor');
    logo.setAttribute('stroke-width', '1.7');
    logo.setAttribute('stroke-linecap', 'round');
    logo.innerHTML = '<rect x="3.5" y="1.5" width="13" height="21" rx="3"/><path d="M8 18.5h4M8 5.5h4"/>';
    const title = document.createElement('h1');
    title.textContent = '云手机';
    titleRow.append(logo, title);
    const summary = document.createElement('p');
    summary.setAttribute('role', 'status');
    summary.textContent = '正在连接设备服务…';
    const headerMain = document.createElement('div');
    headerMain.className = 'dashboard-header-main';
    headerMain.append(titleRow, summary);
    const headerActions = document.createElement('div');
    headerActions.className = 'dashboard-header-actions';
    headerActions.append(createInstallGuide());
    header.append(headerMain, headerActions);
    document.body.prepend(header);
    const tracker = HostTracker.getInstance();
    showDeviceReadiness(summary, tracker);
    void fetch('session', { redirect: 'error' })
        .then((response) => {
            if (response.status === 204) {
                const logout = document.createElement('a');
                logout.href = 'logout';
                logout.className = 'logout-link';
                logout.textContent = '退出登录';
                headerActions.append(logout);
            }
        })
        .catch(() => undefined);
};
