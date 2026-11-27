import '../../../style/dialog.css';
import GoogDeviceDescriptor from '../../../types/GoogDeviceDescriptor';
import { DisplayCombinedInfo } from '../../client/StreamReceiver';
import VideoSettings from '../../VideoSettings';
import { StreamClientScrcpy } from './StreamClientScrcpy';
import Size from '../../Size';
import Util from '../../Util';
import { DisplayInfo } from '../../DisplayInfo';
import { ToolBoxButton } from '../../toolbox/ToolBoxButton';
import SvgImage from '../../ui/SvgImage';
import { PlayerClass } from '../../player/BasePlayer';
import { ToolBoxCheckbox } from '../../toolbox/ToolBoxCheckbox';
import { DeviceTracker } from './DeviceTracker';
import { Attribute } from '../../Attribute';
import { StreamReceiverScrcpy } from './StreamReceiverScrcpy';
import { ParamsStreamScrcpy } from '../../../types/ParamsStreamScrcpy';
import { BaseClient } from '../../client/BaseClient';
import { BitrateControl } from '../BitrateControl';

interface ConfigureScrcpyEvents {
    closed: { dialog: ConfigureScrcpy; result: boolean };
}

type Range = {
    max: number;
    min: number;
    step: number;
    formatter?: (value: number) => string;
};

export class ConfigureScrcpy extends BaseClient<ParamsStreamScrcpy, ConfigureScrcpyEvents> {
    private readonly TAG: string;
    private readonly udid: string;
    private readonly escapedUdid: string;
    private deviceName: string;
    private streamReceiver?: StreamReceiverScrcpy;
    private playerName?: string;
    private displayInfo?: DisplayInfo;
    private background: HTMLElement;
    private dialogBody?: HTMLElement;
    private okButton?: HTMLButtonElement;
    private fitToScreenCheckbox?: HTMLInputElement;
    private resetSettingsButton?: HTMLButtonElement;
    private loadSettingsButton?: HTMLButtonElement;
    private saveSettingsButton?: HTMLButtonElement;
    private playerSelectElement?: HTMLSelectElement;
    private bitrateControl?: BitrateControl;
    private displayIdSelectElement?: HTMLSelectElement;
    private encoderSelectElement?: HTMLSelectElement;
    private connectionStatusElement?: HTMLElement;
    private dialogContainer?: HTMLElement;
    private statusText = '';
    private connectionCount = 0;

    constructor(
        private readonly tracker: DeviceTracker,
        descriptor: GoogDeviceDescriptor,
        params: ParamsStreamScrcpy,
        private readonly players: PlayerClass[],
    ) {
        super(params);
        this.udid = descriptor.udid;
        this.escapedUdid = Util.escapeUdid(this.udid);
        this.deviceName = descriptor['ro.product.model'];
        this.TAG = `ConfigureScrcpy[${this.udid}]`;
        this.createStreamReceiver(params);
        this.setTitle(`${this.deviceName} · 投屏设置`);
        this.background = this.createUI();
    }

    public getTracker(): DeviceTracker {
        return this.tracker;
    }

    private createStreamReceiver(params: ParamsStreamScrcpy): void {
        if (this.streamReceiver) {
            this.detachEventsListeners(this.streamReceiver);
            this.streamReceiver.stop();
        }
        this.streamReceiver = new StreamReceiverScrcpy(params);
        this.attachEventsListeners(this.streamReceiver);
    }

    private attachEventsListeners(streamReceiver: StreamReceiverScrcpy): void {
        streamReceiver.on('encoders', this.onEncoders);
        streamReceiver.on('displayInfo', this.onDisplayInfo);
        streamReceiver.on('connected', this.onConnected);
        streamReceiver.on('disconnected', this.onDisconnected);
    }

    private detachEventsListeners(streamReceiver: StreamReceiverScrcpy): void {
        streamReceiver.off('encoders', this.onEncoders);
        streamReceiver.off('displayInfo', this.onDisplayInfo);
        streamReceiver.off('connected', this.onConnected);
        streamReceiver.off('disconnected', this.onDisconnected);
    }

    private updateStatus(): void {
        if (!this.connectionStatusElement) {
            return;
        }
        let text = this.statusText;
        if (this.connectionCount) {
            text = `${text} · 其他连接 ${this.connectionCount}`;
        }
        this.connectionStatusElement.innerText = text;
    }

    private onEncoders = (encoders: string[]): void => {
        // console.log(this.TAG, 'Encoders', encoders);
        const select = this.encoderSelectElement || document.createElement('select');
        let child;
        while ((child = select.firstChild)) {
            select.removeChild(child);
        }
        encoders.unshift('');
        encoders.forEach((value) => {
            const optionElement = document.createElement('option');
            optionElement.setAttribute('value', value);
            optionElement.innerText = value || '自动选择';
            select.appendChild(optionElement);
        });
        this.encoderSelectElement = select;
    };

    private onDisplayInfo = (infoArray: DisplayCombinedInfo[]): void => {
        // console.log(this.TAG, 'Received info');
        this.statusText = '设备已就绪';
        this.updateStatus();
        this.dialogContainer?.classList.add('ready');
        const select = this.displayIdSelectElement || document.createElement('select');
        let child;
        while ((child = select.firstChild)) {
            select.removeChild(child);
        }
        let selectedOptionIdx = -1;
        infoArray.forEach((value: DisplayCombinedInfo, idx: number) => {
            const { displayInfo } = value;
            const { displayId, size } = displayInfo;
            const optionElement = document.createElement('option');
            optionElement.setAttribute('value', displayId.toString());
            optionElement.innerText = `屏幕 ${displayId} · ${size.width} × ${size.height}`;
            select.appendChild(optionElement);
            if (
                (this.displayInfo && this.displayInfo.displayId === displayId) ||
                (!this.displayInfo && displayId === DisplayInfo.DEFAULT_DISPLAY)
            ) {
                selectedOptionIdx = idx;
            }
        });
        if (selectedOptionIdx > -1) {
            select.selectedIndex = selectedOptionIdx;
            const { connectionCount, displayInfo } = infoArray[selectedOptionIdx];
            this.displayInfo = displayInfo;
            this.updateVideoSettingsForPlayer();
            this.connectionCount = connectionCount;
            this.updateStatus();
            if (this.okButton) {
                this.okButton.disabled = false;
            }
        }
        this.displayIdSelectElement = select;
        if (this.dialogBody) {
            this.dialogBody.classList.remove('hidden');
            this.dialogBody.classList.add('visible');
        }
    };

    private onConnected = (): void => {
        // console.log(this.TAG, 'Connected');
        this.statusText = '正在读取设备信息…';
        this.updateStatus();
    };

    private onDisconnected = (): void => {
        // console.log(this.TAG, 'Disconnected');
        this.statusText = '设备已断开';
        this.updateStatus();
        if (this.okButton) {
            this.okButton.disabled = true;
        }
        if (this.dialogBody) {
            this.dialogBody.classList.remove('visible');
            this.dialogBody.classList.add('hidden');
        }
    };

    private onPlayerChange = (): void => {
        this.updateVideoSettingsForPlayer();
    };

    private onDisplayIdChange = (): void => {
        const select = this.displayIdSelectElement;
        if (!select || !this.streamReceiver) {
            return;
        }
        const value = select.options[select.selectedIndex].value;
        const displayId = parseInt(value, 10);
        if (!isNaN(displayId)) {
            this.displayInfo = this.streamReceiver.getDisplayInfo(displayId);
        }
        this.updateVideoSettingsForPlayer();
    };

    private getPlayer(): PlayerClass | undefined {
        if (!this.playerSelectElement) {
            return;
        }
        const playerName = this.playerSelectElement.options[this.playerSelectElement.selectedIndex].value;
        return this.players.find((playerClass) => {
            return playerClass.playerFullName === playerName;
        });
    }

    private updateVideoSettingsForPlayer(): void {
        const player = this.getPlayer();
        if (player) {
            this.playerName = player.playerFullName;
            const storedOrPreferred = player.loadVideoSettings(this.udid, this.displayInfo);
            const fitToScreen = player.getFitToScreenStatus(this.udid, this.displayInfo);
            this.fillInputsFromVideoSettings(storedOrPreferred, fitToScreen);
        }
    }

    private getBasicInput(id: string): HTMLInputElement | null {
        const element = document.getElementById(`${id}_${this.escapedUdid}`);
        if (!element) {
            return null;
        }
        return element as HTMLInputElement;
    }

    private fillInputsFromVideoSettings(videoSettings: VideoSettings, fitToScreen: boolean): void {
        if (this.displayInfo && this.displayInfo.displayId !== videoSettings.displayId) {
            console.error(this.TAG, `Display id from VideoSettings and DisplayInfo don't match`);
        }
        this.bitrateControl?.setValue(videoSettings.bitrate);
        this.fillBasicInput({ id: 'maxFps' }, videoSettings);
        this.fillBasicInput({ id: 'iFrameInterval' }, videoSettings);
        // this.fillBasicInput({ id: 'displayId' }, videoSettings);
        this.fillBasicInput({ id: 'codecOptions' }, videoSettings);
        if (videoSettings.bounds) {
            const { width, height } = videoSettings.bounds;
            const widthInput = this.getBasicInput('maxWidth');
            if (widthInput) {
                widthInput.value = width.toString(10);
            }
            const heightInput = this.getBasicInput('maxHeight');
            if (heightInput) {
                heightInput.value = height.toString(10);
            }
        }
        if (this.encoderSelectElement) {
            const encoderName = videoSettings.encoderName || '';
            const option = Array.from(this.encoderSelectElement.options).find((element) => {
                return element.value === encoderName;
            });
            if (option) {
                this.encoderSelectElement.selectedIndex = option.index;
            }
        }
        if (this.fitToScreenCheckbox) {
            this.fitToScreenCheckbox.checked = fitToScreen;
            this.onFitToScreenChanged(fitToScreen);
        }
    }

    private onFitToScreenChanged(checked: boolean) {
        const heightInput = this.getBasicInput('maxHeight');
        const widthInput = this.getBasicInput('maxWidth');
        if (!this.fitToScreenCheckbox || !heightInput || !widthInput) {
            return;
        }
        heightInput.disabled = widthInput.disabled = checked;
        if (checked) {
            heightInput.setAttribute(Attribute.VALUE, heightInput.value);
            heightInput.value = '';
            widthInput.setAttribute(Attribute.VALUE, widthInput.value);
            widthInput.value = '';
        } else {
            const storedHeight = heightInput.getAttribute(Attribute.VALUE);
            if (typeof storedHeight === 'string') {
                heightInput.value = storedHeight;
                heightInput.removeAttribute(Attribute.VALUE);
            }
            const storedWidth = widthInput.getAttribute(Attribute.VALUE);
            if (typeof storedWidth === 'string') {
                widthInput.value = storedWidth;
                widthInput.removeAttribute(Attribute.VALUE);
            }
        }
    }

    private fillBasicInput(opts: { id: keyof VideoSettings }, videoSettings: VideoSettings): void {
        const input = this.getBasicInput(opts.id);
        const value = videoSettings[opts.id];
        if (input) {
            if (typeof value !== 'undefined' && value !== '-' && value !== 0 && value !== null) {
                input.value = value.toString(10);
                if (input.getAttribute('type') === 'range') {
                    input.dispatchEvent(new Event('input'));
                }
            } else {
                input.value = '';
            }
        }
    }

    private appendBasicInput(
        parent: HTMLElement,
        opts: { label: string; id: string; range?: Range },
    ): HTMLInputElement {
        const label = document.createElement('label');
        label.classList.add('label');
        label.innerText = opts.label;
        label.id = `label_${opts.id}_${this.escapedUdid}`;
        parent.appendChild(label);
        const input = document.createElement('input');
        input.classList.add('input');
        input.id = label.htmlFor = `${opts.id}_${this.escapedUdid}`;
        const { range } = opts;
        if (range) {
            label.setAttribute('title', opts.label);
            input.oninput = () => {
                const value = range.formatter ? range.formatter(parseInt(input.value, 10)) : input.value;
                label.innerText = `${opts.label} (${value})`;
            };
            input.setAttribute('type', 'range');
            input.setAttribute('max', range.max.toString());
            input.setAttribute('min', range.min.toString());
            input.setAttribute('step', range.step.toString());
        }
        parent.appendChild(input);
        return input;
    }

    private getNumberValueFromInput(name: string): number {
        const value = (document.getElementById(`${name}_${this.escapedUdid}`) as HTMLInputElement).value;
        return parseInt(value, 10);
    }

    private getStringValueFromInput(name: string): string {
        return (document.getElementById(`${name}_${this.escapedUdid}`) as HTMLInputElement).value;
    }

    private getValueFromSelect(name: string): string {
        const select = document.getElementById(`${name}_${this.escapedUdid}`) as HTMLSelectElement;
        return select.options[select.selectedIndex].value;
    }

    private buildVideoSettings(): VideoSettings | null {
        try {
            const bitrate = this.bitrateControl?.readValue();
            if (bitrate === undefined) {
                return null;
            }
            const maxFps = this.getNumberValueFromInput('maxFps');
            const iFrameInterval = this.getNumberValueFromInput('iFrameInterval');
            const maxWidth = this.getNumberValueFromInput('maxWidth');
            const maxHeight = this.getNumberValueFromInput('maxHeight');
            const displayId = this.getNumberValueFromInput('displayId');
            const codecOptions = this.getStringValueFromInput('codecOptions') || undefined;
            let bounds: Size | undefined;
            if (!isNaN(maxWidth) && !isNaN(maxHeight) && maxWidth && maxHeight) {
                bounds = new Size(maxWidth, maxHeight);
            }
            const encoderName = this.getValueFromSelect('encoderName') || undefined;
            return new VideoSettings({
                bitrate,
                bounds,
                maxFps,
                iFrameInterval,
                displayId,
                codecOptions,
                encoderName,
            });
        } catch (error: any) {
            console.error(this.TAG, error.message);
            return null;
        }
    }

    private getFitToScreenValue(): boolean {
        if (!this.fitToScreenCheckbox) {
            return false;
        }
        return this.fitToScreenCheckbox.checked;
    }

    private createUI(): HTMLElement {
        const dialogName = 'configureDialog';
        const blockClass = 'dialog-block';
        const background = document.createElement('div');
        background.classList.add('dialog-background', dialogName);
        const dialogContainer = (this.dialogContainer = document.createElement('div'));
        dialogContainer.classList.add('dialog-container', dialogName);
        const dialogHeader = document.createElement('div');
        dialogHeader.classList.add('dialog-header', dialogName, 'control-wrapper');
        const backButton = new ToolBoxButton('关闭设置', SvgImage.Icon.ARROW_BACK);

        backButton.addEventListener('click', () => {
            this.cancel();
        });
        backButton.getAllElements().forEach((el) => {
            dialogHeader.appendChild(el);
        });

        const deviceName = document.createElement('span');
        deviceName.classList.add('dialog-title', 'main-title');
        deviceName.innerText = '投屏设置';
        dialogHeader.appendChild(deviceName);
        const description = document.createElement('span');
        description.className = 'dialog-device-name';
        description.textContent = this.deviceName;
        dialogHeader.appendChild(description);
        dialogContainer.setAttribute('role', 'dialog');
        dialogContainer.setAttribute('aria-label', '投屏设置');
        const dialogBody = (this.dialogBody = document.createElement('div'));
        dialogBody.classList.add('dialog-body', blockClass, dialogName, 'hidden');
        const playerWrapper = document.createElement('div');
        playerWrapper.classList.add('controls');
        const playerLabel = document.createElement('label');
        playerLabel.classList.add('label');
        playerLabel.innerText = '播放器';
        playerWrapper.appendChild(playerLabel);
        const playerSelect = (this.playerSelectElement = document.createElement('select'));
        playerSelect.classList.add('input');
        playerSelect.id = playerLabel.htmlFor = `player_${this.escapedUdid}`;
        playerWrapper.appendChild(playerSelect);
        dialogBody.appendChild(playerWrapper);
        const previouslyUsedPlayer = StreamClientScrcpy.getPreferredPlayer(this.udid)?.playerFullName;
        this.players.forEach((playerClass, index) => {
            const { playerFullName, playerCodeName } = playerClass;
            const optionElement = document.createElement('option');
            optionElement.setAttribute('value', playerFullName);
            optionElement.innerText = playerCodeName === 'mse' ? '兼容模式（MSE）' : playerFullName;
            playerSelect.appendChild(optionElement);
            if (playerFullName === previouslyUsedPlayer) {
                playerSelect.selectedIndex = index;
            }
        });
        playerSelect.onchange = this.onPlayerChange;

        const controls = document.createElement('div');
        controls.classList.add('controls', 'control-wrapper');
        const displayIdLabel = document.createElement('label');
        displayIdLabel.classList.add('label');
        displayIdLabel.innerText = '屏幕';
        controls.appendChild(displayIdLabel);
        if (!this.displayIdSelectElement) {
            this.displayIdSelectElement = document.createElement('select');
        }
        controls.appendChild(this.displayIdSelectElement);
        this.displayIdSelectElement.classList.add('input');
        this.displayIdSelectElement.id = displayIdLabel.htmlFor = `displayId_${this.escapedUdid}`;
        this.displayIdSelectElement.onchange = this.onDisplayIdChange;

        const bitrateLabel = document.createElement('label');
        bitrateLabel.className = 'label';
        bitrateLabel.textContent = '视频码率（Mbps）';
        const bitrateControl = new BitrateControl(`bitrate_${this.escapedUdid}`);
        bitrateLabel.htmlFor = bitrateControl.input.id;
        bitrateControl.element.classList.add('input');
        controls.append(bitrateLabel, bitrateControl.element);
        this.bitrateControl = bitrateControl;
        this.appendBasicInput(controls, {
            label: '最高帧率',
            id: 'maxFps',
            range: { min: 1, max: 60, step: 1 },
        });
        const presetLabel = document.createElement('span');
        presetLabel.className = 'label';
        presetLabel.textContent = '快捷预设';
        const presetGroup = document.createElement('div');
        presetGroup.className = 'input quality-presets';
        [
            { label: '省流 · 2M', title: '2 Mbps · 30 FPS · 720p', bitrate: 2_000_000, maxFps: 30, size: 720 },
            { label: '均衡 · 8M', title: '8 Mbps · 30 FPS · 1280p', bitrate: 8_000_000, maxFps: 30, size: 1280 },
            { label: '高清 · 16M', title: '16 Mbps · 60 FPS · 1920p', bitrate: 16_000_000, maxFps: 60, size: 1920 },
        ].forEach((preset) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = preset.label;
            btn.title = preset.title;
            btn.onclick = () => {
                this.bitrateControl?.setValue(preset.bitrate);
                const maxFpsInput = document.getElementById(`maxFps_${this.escapedUdid}`) as HTMLInputElement | null;
                if (maxFpsInput) {
                    maxFpsInput.value = String(preset.maxFps);
                    maxFpsInput.dispatchEvent(new Event('input'));
                }
                const maxWidthInput = document.getElementById(
                    `maxWidth_${this.escapedUdid}`,
                ) as HTMLInputElement | null;
                const maxHeightInput = document.getElementById(
                    `maxHeight_${this.escapedUdid}`,
                ) as HTMLInputElement | null;
                if (maxWidthInput && maxHeightInput) {
                    maxWidthInput.value = String(preset.size);
                    maxHeightInput.value = String(preset.size);
                }
            };
            presetGroup.appendChild(btn);
        });
        controls.append(presetLabel, presetGroup);
        dialogBody.appendChild(controls);
        const advanced = document.createElement('details');
        advanced.className = 'settings-advanced';
        const advancedTitle = document.createElement('summary');
        advancedTitle.textContent = '高级选项';
        const advancedControls = document.createElement('div');
        advancedControls.classList.add('controls', 'control-wrapper');
        advanced.append(advancedTitle, advancedControls);
        dialogBody.appendChild(advanced);
        this.appendBasicInput(advancedControls, { label: '关键帧间隔（秒）', id: 'iFrameInterval' });
        const fitLabel = document.createElement('label');
        fitLabel.innerText = '跟随窗口编码尺寸';
        fitLabel.classList.add('label');
        advancedControls.appendChild(fitLabel);
        const fitToggle = new ToolBoxCheckbox(
            '跟随窗口编码尺寸',
            { off: SvgImage.Icon.TOGGLE_OFF, on: SvgImage.Icon.TOGGLE_ON },
            'fit_to_screen',
        );
        fitToggle.getAllElements().forEach((el) => {
            advancedControls.appendChild(el);
            if (el instanceof HTMLLabelElement) {
                fitLabel.htmlFor = el.htmlFor;
                el.classList.add('input');
            }
            if (el instanceof HTMLInputElement) {
                this.fitToScreenCheckbox = el;
            }
        });
        fitToggle.addEventListener('click', (_, el) => {
            const element = el.getElement();
            this.onFitToScreenChanged(element.checked);
        });
        this.appendBasicInput(advancedControls, { label: '最大宽度', id: 'maxWidth' });
        this.appendBasicInput(advancedControls, { label: '最大高度', id: 'maxHeight' });
        this.appendBasicInput(advancedControls, { label: '编码选项', id: 'codecOptions' });

        const encoderLabel = document.createElement('label');
        encoderLabel.classList.add('label');
        encoderLabel.innerText = '编码器';
        advancedControls.appendChild(encoderLabel);
        if (!this.encoderSelectElement) {
            this.encoderSelectElement = document.createElement('select');
        }
        advancedControls.appendChild(this.encoderSelectElement);
        this.encoderSelectElement.classList.add('input');
        this.encoderSelectElement.id = encoderLabel.htmlFor = `encoderName_${this.escapedUdid}`;

        const buttonsWrapper = document.createElement('div');
        buttonsWrapper.className = 'settings-actions';

        const resetSettingsButton = (this.resetSettingsButton = document.createElement('button'));
        resetSettingsButton.classList.add('button');
        resetSettingsButton.innerText = '恢复默认';
        resetSettingsButton.addEventListener('click', this.resetSettings);
        buttonsWrapper.appendChild(resetSettingsButton);

        const loadSettingsButton = (this.loadSettingsButton = document.createElement('button'));
        loadSettingsButton.classList.add('button');
        loadSettingsButton.innerText = '读取已保存';
        loadSettingsButton.addEventListener('click', this.loadSettings);
        buttonsWrapper.appendChild(loadSettingsButton);

        const saveSettingsButton = (this.saveSettingsButton = document.createElement('button'));
        saveSettingsButton.classList.add('button');
        saveSettingsButton.innerText = '保存';
        saveSettingsButton.addEventListener('click', this.saveSettings);
        buttonsWrapper.appendChild(saveSettingsButton);

        dialogBody.appendChild(buttonsWrapper);

        const dialogFooter = document.createElement('div');
        dialogFooter.classList.add('dialog-footer', blockClass, dialogName);
        const statusElement = document.createElement('span');
        statusElement.classList.add('subtitle');
        statusElement.setAttribute('role', 'status');
        this.connectionStatusElement = statusElement;
        dialogFooter.appendChild(statusElement);
        this.statusText = '正在连接设备…';
        this.updateStatus();

        // const cancelButton = (this.cancelButton = document.createElement('button'));
        // cancelButton.innerText = 'Cancel';
        // cancelButton.addEventListener('click', this.cancel);
        const okButton = (this.okButton = document.createElement('button'));
        okButton.innerText = '保存并打开';
        okButton.disabled = true;
        okButton.addEventListener('click', this.openStream);
        dialogFooter.appendChild(okButton);
        // dialogFooter.appendChild(cancelButton);
        dialogContainer.appendChild(dialogHeader);
        dialogContainer.appendChild(dialogBody);
        dialogContainer.appendChild(dialogFooter);
        background.appendChild(dialogContainer);
        background.addEventListener('click', this.onBackgroundClick);
        document.addEventListener('keydown', this.onKeyDown);
        document.body.appendChild(background);
        this.updateVideoSettingsForPlayer();
        return background;
    }

    private removeUI(): void {
        document.body.removeChild(this.background);
        this.okButton?.removeEventListener('click', this.openStream);
        // this.cancelButton?.removeEventListener('click', this.cancel);
        this.resetSettingsButton?.removeEventListener('click', this.resetSettings);
        this.loadSettingsButton?.removeEventListener('click', this.loadSettings);
        this.saveSettingsButton?.removeEventListener('click', this.saveSettings);
        this.background.removeEventListener('click', this.onBackgroundClick);
        document.removeEventListener('keydown', this.onKeyDown);
    }

    private onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            this.cancel();
        }
    };

    private onBackgroundClick = (event: MouseEvent): void => {
        if (event.target !== event.currentTarget) {
            return;
        }
        this.cancel();
    };

    private cancel = (): void => {
        if (this.streamReceiver) {
            this.detachEventsListeners(this.streamReceiver);
            this.streamReceiver.stop();
        }
        this.emit('closed', { dialog: this, result: false });
        this.removeUI();
    };

    private resetSettings = (): void => {
        const player = this.getPlayer();
        if (player) {
            this.fillInputsFromVideoSettings(player.getPreferredVideoSetting(), false);
        }
    };

    private loadSettings = (): void => {
        this.updateVideoSettingsForPlayer();
    };

    private saveSettings = (): void => {
        const videoSettings = this.buildVideoSettings();
        const player = this.getPlayer();
        if (videoSettings && player) {
            const fitToScreen = this.getFitToScreenValue();
            player.saveVideoSettings(this.udid, videoSettings, fitToScreen, this.displayInfo);
            StreamClientScrcpy.savePlayerName(this.udid, player.playerFullName);
            this.tracker.refreshLinks();
            this.statusText = '已保存，下次打开将应用';
            this.updateStatus();
        }
    };

    private openStream = (): void => {
        const videoSettings = this.buildVideoSettings();
        if (!videoSettings || !this.streamReceiver || !this.playerName) {
            return;
        }
        const fitToScreen = this.getFitToScreenValue();
        this.detachEventsListeners(this.streamReceiver);
        this.emit('closed', { dialog: this, result: true });
        this.removeUI();
        const player = StreamClientScrcpy.createPlayer(this.playerName, this.udid, this.displayInfo);
        if (!player) {
            return;
        }
        StreamClientScrcpy.savePlayerName(this.udid, this.playerName);
        // return;
        player.setVideoSettings(videoSettings, fitToScreen, true);
        const params: ParamsStreamScrcpy = {
            ...this.params,
            udid: this.udid,
            fitToScreen,
        };
        const streamUrl = new URL(location.href);
        const query = new URLSearchParams({
            action: params.action,
            udid: params.udid,
            ws: params.ws,
            player: player.getName(),
            fitToScreen: String(fitToScreen),
            captureKeyboard: String(params.captureKeyboard ?? false),
        });
        streamUrl.hash = `!${query}`;
        history.replaceState(null, '', streamUrl);
        StreamClientScrcpy.start(params, this.streamReceiver, player, fitToScreen, videoSettings);
    };
}
