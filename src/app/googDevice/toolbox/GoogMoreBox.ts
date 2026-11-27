import '../../../style/morebox.css';
import { BasePlayer } from '../../player/BasePlayer';
import { TextControlMessage } from '../../controlMessage/TextControlMessage';
import { CommandControlMessage } from '../../controlMessage/CommandControlMessage';
import { ControlMessage } from '../../controlMessage/ControlMessage';
import Size from '../../Size';
import DeviceMessage from '../DeviceMessage';
import VideoSettings from '../../VideoSettings';
import { StreamClientScrcpy } from '../client/StreamClientScrcpy';
import { BitrateControl } from '../BitrateControl';

const TAG = '[GoogMoreBox]';
const COMMAND_LABELS = new Map([
    [ControlMessage.TYPE_CHANGE_STREAM_PARAMETERS, '应用并保存'],
    [ControlMessage.TYPE_EXPAND_NOTIFICATION_PANEL, '展开通知'],
    [ControlMessage.TYPE_EXPAND_SETTINGS_PANEL, '展开快捷设置'],
    [ControlMessage.TYPE_COLLAPSE_PANELS, '收起面板'],
    [CommandControlMessage.TYPE_SET_CLIPBOARD, '发送剪贴板'],
    [CommandControlMessage.TYPE_GET_CLIPBOARD, '读取剪贴板'],
    [CommandControlMessage.TYPE_ROTATE_DEVICE, '旋转设备'],
]);

export class GoogMoreBox {
    private static defaultSize = new Size(480, 480);
    private onStop?: () => void;
    private onOpenChange?: (open: boolean) => void;
    private readonly holder: HTMLElement;
    private readonly input: HTMLTextAreaElement;
    private readonly bitrateControl?: BitrateControl;
    private readonly maxFpsInput?: HTMLInputElement;
    private readonly iFrameIntervalInput?: HTMLInputElement;
    private readonly maxWidthInput?: HTMLInputElement;
    private readonly maxHeightInput?: HTMLInputElement;
    private readonly actionStatus = document.createElement('p');
    private readonly profileMessage = document.createElement('p');
    private readonly streamReport = document.createElement('p');
    private actionStatusTimer?: number;
    private reportTimer?: number;
    private isOpen = false;
    private report?: { settings: VideoSettings; size: Size };
    private requestedProfile?: VideoSettings;
    private connectionMetrics?: { firstFrameMs: number; reconnects: number };

    constructor(udid: string, private player: BasePlayer, private client: StreamClientScrcpy) {
        const playerName = player.getName();
        const videoSettings = player.getVideoSettings();
        const { displayId } = videoSettings;
        const preferredSettings = player.getPreferredVideoSetting();
        const moreBox = document.createElement('div');
        moreBox.className = 'more-box';
        const nameBox = document.createElement('p');
        nameBox.innerText = '投屏控制';
        nameBox.className = 'text-with-shadow';
        moreBox.appendChild(nameBox);
        const input = (this.input = document.createElement('textarea'));
        input.classList.add('text-area');
        input.setAttribute('aria-label', '发送到 Android 的文本');
        input.placeholder = '输入要发往 Android 的文本（Ctrl/Cmd + Enter 发送）';
        const sendButton = document.createElement('button');
        sendButton.type = 'button';
        sendButton.innerText = '发送文本';

        const sendText = () => {
            if (input.value) {
                client.sendMessage(new TextControlMessage(input.value));
                this.showActionStatus('已发送文本到设备');
            }
        };
        const inputWrapper = GoogMoreBox.wrap('p', [input, sendButton], moreBox);
        sendButton.onclick = sendText;
        input.addEventListener('keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                sendText();
            }
        });
        this.actionStatus.className = 'action-status';
        this.actionStatus.setAttribute('role', 'status');
        moreBox.appendChild(this.actionStatus);

        const commands: HTMLElement[] = [];
        const codes = CommandControlMessage.Commands;
        for (const [action, command] of codes.entries()) {
            const btn = document.createElement('button');
            let bitrateControl: BitrateControl;
            let maxFpsInput: HTMLInputElement;
            let iFrameIntervalInput: HTMLInputElement;
            let maxWidthInput: HTMLInputElement;
            let maxHeightInput: HTMLInputElement;
            if (action === ControlMessage.TYPE_CHANGE_STREAM_PARAMETERS) {
                const spoiler = document.createElement('div');
                const spoilerLabel = document.createElement('label');
                const spoilerCheck = document.createElement('input');

                const innerDiv = document.createElement('div');
                const id = `spoiler_video_${udid}_${playerName}_${displayId}_${action}`;

                spoiler.className = 'spoiler';
                spoilerCheck.type = 'checkbox';
                spoilerCheck.id = id;
                spoilerLabel.htmlFor = id;
                spoilerLabel.innerText = '画质与帧率';
                innerDiv.className = 'box';
                spoiler.appendChild(spoilerCheck);
                spoiler.appendChild(spoilerLabel);
                spoiler.appendChild(innerDiv);

                const bitrateLabel = document.createElement('label');
                bitrateLabel.innerText = '视频码率（Mbps）';
                bitrateControl = new BitrateControl(`${id}_bitrate`);
                bitrateLabel.htmlFor = bitrateControl.input.id;
                bitrateControl.setValue(videoSettings.bitrate);
                GoogMoreBox.wrap('div', [bitrateLabel, bitrateControl.element], innerDiv);
                this.bitrateControl = bitrateControl;

                const maxFpsLabel = document.createElement('label');
                maxFpsLabel.innerText = `最高帧率 · ${videoSettings.maxFps} FPS`;
                maxFpsInput = document.createElement('input');
                maxFpsInput.type = 'range';
                maxFpsInput.min = '1';
                maxFpsInput.max = '60';
                maxFpsInput.step = '1';
                maxFpsInput.id = `${id}_fps`;
                maxFpsLabel.htmlFor = maxFpsInput.id;
                maxFpsInput.value = videoSettings.maxFps.toString();
                maxFpsInput.oninput = () => {
                    maxFpsLabel.innerText = `最高帧率 · ${maxFpsInput.value} FPS`;
                };
                GoogMoreBox.wrap('div', [maxFpsLabel, maxFpsInput], innerDiv);
                this.maxFpsInput = maxFpsInput;

                const iFrameIntervalLabel = document.createElement('label');
                iFrameIntervalLabel.innerText = '关键帧间隔（秒）';
                iFrameIntervalInput = document.createElement('input');
                iFrameIntervalInput.placeholder = `${preferredSettings.iFrameInterval} seconds`;
                iFrameIntervalInput.value = videoSettings.iFrameInterval.toString();
                GoogMoreBox.wrap('div', [iFrameIntervalLabel, iFrameIntervalInput], innerDiv);
                this.iFrameIntervalInput = iFrameIntervalInput;

                const { width, height } = videoSettings.bounds || client.getMaxSize() || GoogMoreBox.defaultSize;
                const pWidth = preferredSettings.bounds?.width || width;
                const pHeight = preferredSettings.bounds?.height || height;

                const maxWidthLabel = document.createElement('label');
                maxWidthLabel.innerText = '最大宽度';
                maxWidthInput = document.createElement('input');
                maxWidthInput.placeholder = `${pWidth} px`;
                maxWidthInput.value = width.toString();
                GoogMoreBox.wrap('div', [maxWidthLabel, maxWidthInput], innerDiv);
                this.maxWidthInput = maxWidthInput;

                const maxHeightLabel = document.createElement('label');
                maxHeightLabel.innerText = '最大高度';
                maxHeightInput = document.createElement('input');
                maxHeightInput.placeholder = `${pHeight} px`;
                maxHeightInput.value = height.toString();
                GoogMoreBox.wrap('div', [maxHeightLabel, maxHeightInput], innerDiv);
                this.maxHeightInput = maxHeightInput;

                this.profileMessage.className = 'stream-report';
                this.profileMessage.setAttribute('role', 'status');
                this.streamReport.className = 'stream-report';
                innerDiv.append(this.profileMessage, this.streamReport);
                innerDiv.appendChild(btn);
                const fitButton = document.createElement('button');
                fitButton.innerText = '匹配窗口';
                fitButton.onclick = this.fit;
                innerDiv.insertBefore(fitButton, innerDiv.firstChild);
                const resetButton = document.createElement('button');
                resetButton.innerText = '恢复默认';
                resetButton.onclick = this.reset;
                innerDiv.insertBefore(resetButton, innerDiv.firstChild);
                commands.push(spoiler);
            } else {
                if (
                    action === CommandControlMessage.TYPE_SET_CLIPBOARD ||
                    action === CommandControlMessage.TYPE_GET_CLIPBOARD
                ) {
                    inputWrapper.appendChild(btn);
                } else {
                    commands.push(btn);
                }
            }
            btn.innerText = COMMAND_LABELS.get(action) ?? command;
            if (action === ControlMessage.TYPE_CHANGE_STREAM_PARAMETERS) {
                btn.onclick = () => {
                    const bitrate = bitrateControl.readValue();
                    const maxFps = parseInt(maxFpsInput.value, 10);
                    const iFrameInterval = Number(iFrameIntervalInput.value);
                    if (bitrate === undefined || isNaN(maxFps)) {
                        return;
                    }
                    const width = Number(maxWidthInput.value);
                    const height = Number(maxHeightInput.value);
                    if (
                        !iFrameIntervalInput.value.trim() ||
                        !Number.isInteger(iFrameInterval) ||
                        iFrameInterval < -128 ||
                        iFrameInterval > 127
                    ) {
                        this.setProfileStatus('关键帧间隔须填写 -128 至 127 之间的整数。');
                        return;
                    }
                    if (![width, height].every((value) => Number.isInteger(value) && value >= 16 && value <= 32767)) {
                        this.setProfileStatus('宽度和高度须填写 16 至 32767 之间的整数。');
                        return;
                    }
                    const bounds = new Size(width & ~15, height & ~15);
                    const current = player.getVideoSettings();
                    const { lockedVideoOrientation, sendFrameMeta, displayId, codecOptions, encoderName } = current;
                    const videoSettings = new VideoSettings({
                        bounds,
                        bitrate,
                        maxFps,
                        iFrameInterval,
                        lockedVideoOrientation,
                        sendFrameMeta,
                        displayId,
                        codecOptions,
                        encoderName,
                    });
                    client.sendNewVideoSetting(videoSettings);
                };
            } else if (action === CommandControlMessage.TYPE_SET_CLIPBOARD) {
                btn.onclick = () => {
                    const text = input.value;
                    if (text) {
                        client.sendMessage(CommandControlMessage.createSetClipboardCommand(text));
                        this.showActionStatus('已发送到设备剪贴板');
                    }
                };
            } else {
                btn.onclick = () => {
                    client.sendMessage(new CommandControlMessage(action));
                    if (action === CommandControlMessage.TYPE_GET_CLIPBOARD) {
                        this.showActionStatus('正在读取设备剪贴板…');
                    }
                };
            }
        }
        GoogMoreBox.wrap('p', commands, moreBox);

        const screenOffButton = document.createElement('button');
        screenOffButton.type = 'button';
        screenOffButton.innerText = '息屏';
        screenOffButton.onclick = () => {
            client.sendMessage(CommandControlMessage.createSetScreenPowerModeCommand(false));
            this.showActionStatus('已发送息屏指令');
        };
        const screenOnButton = document.createElement('button');
        screenOnButton.type = 'button';
        screenOnButton.innerText = '亮屏';
        screenOnButton.onclick = () => {
            client.sendMessage(CommandControlMessage.createSetScreenPowerModeCommand(true));
            this.showActionStatus('已发送亮屏指令');
        };
        GoogMoreBox.wrap('p', [screenOffButton, screenOnButton], moreBox, ['flex-center', 'screen-power-actions']);

        const qualityId = `show_video_quality_${udid}_${playerName}_${displayId}`;
        const qualityLabel = document.createElement('label');
        const qualityCheck = document.createElement('input');
        qualityCheck.type = 'checkbox';
        qualityCheck.checked = BasePlayer.DEFAULT_SHOW_QUALITY_STATS;
        qualityCheck.id = qualityId;
        qualityLabel.htmlFor = qualityId;
        qualityLabel.innerText = '显示串流统计';
        GoogMoreBox.wrap('p', [qualityCheck, qualityLabel], moreBox, ['flex-center']);
        qualityCheck.onchange = () => {
            player.setShowQualityStats(qualityCheck.checked);
        };

        const einkId = `eink_mode_${udid}_${playerName}_${displayId}`;
        const einkLabel = document.createElement('label');
        const einkCheck = document.createElement('input');
        einkCheck.type = 'checkbox';
        einkCheck.id = einkId;
        einkLabel.htmlFor = einkId;
        einkLabel.innerText = '墨水屏模式';
        try {
            einkCheck.checked = localStorage.getItem('ws_scrcpy::eink_mode') === '1';
        } catch {
            einkCheck.checked = false;
        }
        GoogMoreBox.wrap('p', [einkCheck, einkLabel], moreBox, ['flex-center']);
        einkCheck.onchange = () => {
            const enabled = einkCheck.checked;
            moreBox.closest('.device-view')?.classList.toggle('eink-mode', enabled);
            try {
                if (enabled) {
                    localStorage.setItem('ws_scrcpy::eink_mode', '1');
                } else {
                    localStorage.removeItem('ws_scrcpy::eink_mode');
                }
            } catch {
                // ignore storage errors
            }
        };

        const stop = (ev?: string | Event) => {
            if (ev && ev instanceof Event && ev.type === 'error') {
                console.error(TAG, ev);
            }
            const parent = moreBox.parentElement;
            if (parent) {
                parent.removeChild(moreBox);
            }
            if (this.onStop) {
                this.onStop();
                delete this.onStop;
            }
        };

        const stopBtn = document.createElement('button') as HTMLButtonElement;
        stopBtn.type = 'button';
        stopBtn.className = 'danger-button';
        stopBtn.innerText = '断开连接';
        stopBtn.onclick = stop;

        GoogMoreBox.wrap('p', [stopBtn], moreBox);
        player.on('video-settings', this.onVideoSettings);
        document.addEventListener('pointerdown', this.onOutsidePointerDown);
        document.addEventListener('keydown', this.onDocumentKeyDown);
        this.holder = moreBox;
    }

    private onVideoSettings = (videoSettings: VideoSettings): void => {
        this.bitrateControl?.setValue(videoSettings.bitrate);
        if (this.maxFpsInput) {
            this.maxFpsInput.value = videoSettings.maxFps.toString();
            this.maxFpsInput.dispatchEvent(new Event('input'));
        }
        if (this.iFrameIntervalInput) {
            this.iFrameIntervalInput.value = videoSettings.iFrameInterval.toString();
        }
        if (videoSettings.bounds) {
            const { width, height } = videoSettings.bounds;
            if (this.maxWidthInput) {
                this.maxWidthInput.value = width.toString();
            }
            if (this.maxHeightInput) {
                this.maxHeightInput.value = height.toString();
            }
        }
    };

    public setProfileStatus(status: string): void {
        this.profileMessage.textContent = status;
    }

    public setStreamReport(settings: VideoSettings, size: Size): void {
        this.report = { settings, size };
        this.renderStreamReport();
    }

    public setRequestedProfile(settings: VideoSettings): void {
        this.requestedProfile = settings;
        this.renderStreamReport();
    }

    public setConnectionMetrics(firstFrameMs: number, reconnects: number): void {
        this.connectionMetrics = { firstFrameMs, reconnects };
        this.renderStreamReport();
    }

    public clearStreamReport(): void {
        this.report = undefined;
        this.renderStreamReport();
    }

    private formatProfile(settings: VideoSettings): string {
        const { bitrate, maxFps, iFrameInterval, bounds, encoderName } = settings;
        const size = bounds ? `${bounds.width} × ${bounds.height}` : '不限';
        const encoder = encoderName ? ` · ${encoderName}` : '';
        return `上限 ${size} · ${bitrate / 1_000_000} Mbps · ${maxFps} FPS · 关键帧 ${iFrameInterval} 秒${encoder}`;
    }

    private renderStreamReport = (): void => {
        const lines: string[] = [];
        if (this.requestedProfile) {
            lines.push(`请求：${this.formatProfile(this.requestedProfile)}`);
        }
        if (this.report) {
            const { settings, size } = this.report;
            const mbps = this.player.getReceivedMbps();
            lines.push(`设备回报：画面 ${size.width} × ${size.height} · ${this.formatProfile(settings)}`);
            if (mbps !== undefined) {
                lines.push(`浏览器实收：约 ${mbps.toFixed(1)} Mbps`);
            }
        }
        if (this.connectionMetrics) {
            const { firstFrameMs, reconnects } = this.connectionMetrics;
            lines.push(`最近首帧：${firstFrameMs} ms · 本次重连：${reconnects} 次`);
        }
        this.streamReport.replaceChildren();
        for (const line of lines) {
            if (this.streamReport.hasChildNodes()) {
                this.streamReport.append(document.createElement('br'));
            }
            this.streamReport.append(line);
        }
    };

    public setOpen(open: boolean): void {
        if (this.isOpen === open && this.holder.style.display === (open ? 'block' : 'none')) {
            return;
        }
        this.isOpen = open;
        this.holder.style.display = open ? 'block' : 'none';
        window.clearInterval(this.reportTimer);
        this.reportTimer = undefined;
        if (open) {
            this.renderStreamReport();
            this.reportTimer = window.setInterval(this.renderStreamReport, 1000);
        }
        this.onOpenChange?.(open);
    }

    public setOnOpenChange(listener: (open: boolean) => void): void {
        this.onOpenChange = listener;
    }

    private showActionStatus(message: string): void {
        window.clearTimeout(this.actionStatusTimer);
        this.actionStatus.textContent = message;
        this.actionStatusTimer = window.setTimeout(() => {
            this.actionStatus.textContent = '';
        }, 2500);
    }

    private onOutsidePointerDown = (event: PointerEvent): void => {
        if (!this.isOpen) {
            return;
        }
        const target = event.target as HTMLElement | null;
        if (!target) {
            return;
        }
        if (this.holder.contains(target) || target.closest('.control-buttons-list')) {
            return;
        }
        this.setOpen(false);
    };

    private onDocumentKeyDown = (event: KeyboardEvent): void => {
        if (this.isOpen && event.key === 'Escape') {
            event.stopPropagation();
            this.setOpen(false);
        }
    };

    public dispose(): void {
        window.clearInterval(this.reportTimer);
        window.clearTimeout(this.actionStatusTimer);
        document.removeEventListener('pointerdown', this.onOutsidePointerDown);
        document.removeEventListener('keydown', this.onDocumentKeyDown);
        this.player.off('video-settings', this.onVideoSettings);
    }

    private fit = (): void => {
        const { width, height } = this.client.getMaxSize() || GoogMoreBox.defaultSize;
        if (this.maxWidthInput) {
            this.maxWidthInput.value = width.toString();
        }
        if (this.maxHeightInput) {
            this.maxHeightInput.value = height.toString();
        }
    };

    private reset = (): void => {
        const preferredSettings = this.player.getPreferredVideoSetting();
        this.onVideoSettings(preferredSettings);
    };

    public OnDeviceMessage(ev: DeviceMessage): void {
        if (ev.type !== DeviceMessage.TYPE_CLIPBOARD) {
            return;
        }
        this.input.value = ev.getText();
        this.input.select();
        document.execCommand('copy');
        this.showActionStatus('已读取设备剪贴板');
    }

    private static wrap(
        tagName: string,
        elements: HTMLElement[],
        parent: HTMLElement,
        opt_classes?: string[],
    ): HTMLElement {
        const wrap = document.createElement(tagName);
        if (opt_classes) {
            wrap.classList.add(...opt_classes);
        }
        elements.forEach((e) => {
            wrap.appendChild(e);
        });
        parent.appendChild(wrap);
        return wrap;
    }

    public getHolderElement(): HTMLElement {
        return this.holder;
    }

    public setOnStop(listener: () => void): void {
        this.onStop = listener;
    }
}
