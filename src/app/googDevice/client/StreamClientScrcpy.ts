import { BaseClient } from '../../client/BaseClient';
import { ParamsStreamScrcpy } from '../../../types/ParamsStreamScrcpy';
import { GoogMoreBox } from '../toolbox/GoogMoreBox';
import { GoogToolBox } from '../toolbox/GoogToolBox';
import VideoSettings from '../../VideoSettings';
import Size from '../../Size';
import { ControlMessage } from '../../controlMessage/ControlMessage';
import { ClientsStats, DisplayCombinedInfo } from '../../client/StreamReceiver';
import { CommandControlMessage } from '../../controlMessage/CommandControlMessage';
import Util from '../../Util';
import FilePushHandler from '../filePush/FilePushHandler';
import DragAndPushLogger from '../DragAndPushLogger';
import { KeyEventListener, KeyInputHandler } from '../KeyInputHandler';
import { KeyCodeControlMessage } from '../../controlMessage/KeyCodeControlMessage';
import { BasePlayer, PlayerClass } from '../../player/BasePlayer';
import GoogDeviceDescriptor from '../../../types/GoogDeviceDescriptor';
import { ConfigureScrcpy } from './ConfigureScrcpy';
import { DeviceTracker } from './DeviceTracker';
import { ControlCenterCommand } from '../../../common/ControlCenterCommand';
import { html } from '../../ui/HtmlTag';
import {
    FeaturedInteractionHandler,
    InteractionHandlerListener,
} from '../../interactionHandler/FeaturedInteractionHandler';
import DeviceMessage from '../DeviceMessage';
import { DisplayInfo } from '../../DisplayInfo';
import { Attribute } from '../../Attribute';
import { HostTracker } from '../../client/HostTracker';
import { ACTION } from '../../../common/Action';
import { StreamReceiverScrcpy } from './StreamReceiverScrcpy';
import { ParamsDeviceTracker } from '../../../types/ParamsDeviceTracker';
import { ScrcpyFilePushStream } from '../filePush/ScrcpyFilePushStream';
import { StreamFullscreen } from '../StreamFullscreen';
import { StreamRecovery, StreamStatus } from '../StreamRecovery';
import { getScrcpyPlayerOptions } from '../ScrcpyPlayers';

type StartParams = {
    udid: string;
    playerName?: string;
    player?: BasePlayer;
    fitToScreen?: boolean;
    videoSettings?: VideoSettings;
};

const TAG = '[StreamClientScrcpy]';

export class StreamClientScrcpy
    extends BaseClient<ParamsStreamScrcpy, never>
    implements KeyEventListener, InteractionHandlerListener
{
    public static ACTION = 'stream';
    private static players: Map<string, PlayerClass> = new Map<string, PlayerClass>();

    private videoViewport?: HTMLElement;
    private fullscreen?: StreamFullscreen;
    private deviceName = '';
    private clientId = -1;
    private clientsCount = -1;
    private joinedStream = false;
    private applyProfileOnJoin = false;
    private profileTimer?: ReturnType<typeof setTimeout>;
    private desiredProfile?: VideoSettings;
    private requestedProfile?: VideoSettings;
    private reportedProfile?: VideoSettings;
    private touchHandler?: FeaturedInteractionHandler;
    private moreBox?: GoogMoreBox;
    private player?: BasePlayer;
    private filePushHandler?: FilePushHandler;
    private fitToScreen?: boolean;
    private streamStatus?: HTMLElement;
    private retryMessage?: HTMLElement;
    private streamReceiver?: StreamReceiverScrcpy;
    private readonly recovery = new StreamRecovery({
        connect: () => this.connectStream(),
        disconnect: () => this.disconnectStream(),
        status: (status) => this.showStreamStatus(status),
        sessionExpired: () => this.sessionExpired(),
    });
    private keyboardEnabled = false;
    private suspended = false;

    public static getPlayers(): ReturnType<typeof getScrcpyPlayerOptions> {
        return getScrcpyPlayerOptions();
    }

    public static getPreferredPlayer(udid?: string): ReturnType<typeof getScrcpyPlayerOptions>[number] | undefined {
        let saved = '';
        if (udid) {
            try {
                saved = localStorage.getItem(this.getPlayerStorageKey(udid)) ?? '';
            } catch {
                saved = '';
            }
        }
        const options = this.getPlayers();
        const selected = options.find(
            ({ playerCodeName, playerFullName }) => saved === playerCodeName || saved === playerFullName,
        );
        return selected ?? options[0];
    }

    public static async loadPlayer(udid: string, name: string | null): Promise<PlayerClass | undefined> {
        const options = this.getPlayers();
        const selected = options.find(
            ({ playerCodeName, playerFullName }) => name === playerCodeName || name === playerFullName,
        );
        const preferred = selected ?? this.getPreferredPlayer(udid);
        const candidates = preferred ? [preferred, ...options.filter((option) => option !== preferred)] : options;
        for (const option of candidates) {
            const player = await this.registerPlayer(option);
            if (player) {
                return player;
            }
        }
        return undefined;
    }

    public static async loadPlayers(): Promise<PlayerClass[]> {
        const players = await Promise.all(this.getPlayers().map((option) => this.registerPlayer(option)));
        return players.filter((player): player is PlayerClass => player !== undefined);
    }

    private static async registerPlayer(
        option: ReturnType<typeof getScrcpyPlayerOptions>[number],
    ): Promise<PlayerClass | undefined> {
        const cached = this.players.get(option.playerFullName);
        if (cached) {
            return cached;
        }
        try {
            const player = await option.load();
            if (player.isSupported()) {
                this.players.set(player.playerFullName, player);
                return player;
            }
        } catch (error) {
            console.warn(TAG, `无法加载播放器 ${option.playerFullName}`, error);
        }
        return undefined;
    }

    private static getPlayerStorageKey(udid: string): string {
        return `configure_stream::${Util.escapeUdid(udid)}::player`;
    }

    public static savePlayerName(udid: string, playerName: string): void {
        try {
            localStorage.setItem(this.getPlayerStorageKey(udid), playerName);
        } catch (error) {
            console.warn('无法保存播放器选择', error);
        }
    }

    private static getPlayerClass(playerName: string): PlayerClass | undefined {
        let playerClass: PlayerClass | undefined;
        for (const value of StreamClientScrcpy.players.values()) {
            if (value.playerFullName === playerName || value.playerCodeName === playerName) {
                playerClass = value;
            }
        }
        return playerClass;
    }

    public static createPlayer(playerName: string, udid: string, displayInfo?: DisplayInfo): BasePlayer | undefined {
        const playerClass = this.getPlayerClass(playerName);
        if (!playerClass) {
            return;
        }
        return new playerClass(udid, displayInfo);
    }

    public static getFitToScreen(playerName: string, udid: string, displayInfo?: DisplayInfo): boolean {
        const playerClass = this.getPlayerClass(playerName);
        if (!playerClass) {
            return false;
        }
        return playerClass.getFitToScreenStatus(udid, displayInfo);
    }

    public static start(
        query: URLSearchParams | ParamsStreamScrcpy,
        streamReceiver?: StreamReceiverScrcpy,
        player?: BasePlayer,
        fitToScreen?: boolean,
        videoSettings?: VideoSettings,
    ): StreamClientScrcpy {
        if (query instanceof URLSearchParams) {
            const params = StreamClientScrcpy.parseParameters(query);
            return new StreamClientScrcpy(params, streamReceiver, player, fitToScreen, videoSettings);
        } else {
            return new StreamClientScrcpy(query, streamReceiver, player, fitToScreen, videoSettings);
        }
    }

    private static createVideoSettingsWithBounds(old: VideoSettings, newBounds: Size): VideoSettings {
        return new VideoSettings({
            crop: old.crop,
            bitrate: old.bitrate,
            bounds: newBounds,
            maxFps: old.maxFps,
            iFrameInterval: old.iFrameInterval,
            sendFrameMeta: old.sendFrameMeta,
            lockedVideoOrientation: old.lockedVideoOrientation,
            displayId: old.displayId,
            codecOptions: old.codecOptions,
            encoderName: old.encoderName,
        });
    }

    protected constructor(
        params: ParamsStreamScrcpy,
        streamReceiver?: StreamReceiverScrcpy,
        player?: BasePlayer,
        fitToScreen?: boolean,
        videoSettings?: VideoSettings,
    ) {
        super(params);
        this.streamReceiver = streamReceiver;

        const { udid, player: playerName } = this.params;
        // Allow the stream deep link to start already fit to screen
        // (?fitToScreen=1), so an embedded/auto-started stream can request it
        // without going through the Configure screen.
        if (typeof fitToScreen !== 'boolean') {
            fitToScreen = this.params.fitToScreen;
        }
        this.startStream({ udid, player, playerName, fitToScreen, videoSettings });
        this.setBodyClass('stream');
    }

    public static parseParameters(params: URLSearchParams): ParamsStreamScrcpy {
        const typedParams = super.parseParameters(params);
        const { action } = typedParams;
        if (action !== ACTION.STREAM_SCRCPY) {
            throw Error('Incorrect action');
        }
        return {
            ...typedParams,
            action,
            player: Util.parseString(params, 'player', true),
            udid: Util.parseString(params, 'udid', true),
            ws: Util.parseString(params, 'ws', true),
            captureKeyboard: Util.parseBoolean(params, 'captureKeyboard', false),
            fitToScreen: params.has('fitToScreen') ? Util.parseBoolean(params, 'fitToScreen') : undefined,
        };
    }

    public OnDeviceMessage = (message: DeviceMessage): void => {
        if (this.moreBox) {
            this.moreBox.OnDeviceMessage(message);
        }
    };

    public onVideo = (data: Uint8Array): void => {
        const player = this.player;
        if (!player) {
            return;
        }
        const STATE = BasePlayer.STATE;
        try {
            if (player.getState() === STATE.PAUSED) {
                player.play();
            }
            if (player.getState() === STATE.PLAYING) {
                player.pushFrame(data);
            }
        } catch (error) {
            this.onPlaybackError(error);
        }
    };

    public onClientsStats = (stats: ClientsStats): void => {
        this.deviceName = stats.deviceName;
        this.clientId = stats.clientId;
        this.setTitle(`${this.deviceName} · 云手机`);
    };

    public onDisplayInfo = (infoArray: DisplayCombinedInfo[]): void => {
        if (!this.player) {
            return;
        }
        let currentSettings = this.desiredProfile ?? this.player.getVideoSettings();
        const displayId = currentSettings.displayId;
        const info = infoArray.find((value) => {
            return value.displayInfo.displayId === displayId;
        });
        if (!info) {
            return;
        }
        const { videoSettings, screenInfo } = info;
        if (videoSettings && screenInfo) {
            this.reportedProfile = videoSettings;
            this.confirmProfile(videoSettings);
            this.moreBox?.setStreamReport(videoSettings, screenInfo.videoSize);
        }
        this.player.setDisplayInfo(info.displayInfo);
        if (typeof this.fitToScreen !== 'boolean') {
            this.fitToScreen = this.player.getFitToScreenStatus();
        }
        if (this.fitToScreen && !this.joinedStream) {
            const newBounds = this.getMaxSize();
            if (newBounds) {
                currentSettings = StreamClientScrcpy.createVideoSettingsWithBounds(currentSettings, newBounds);
            }
        }
        const applySavedProfile = !this.joinedStream && this.applyProfileOnJoin;
        if (!videoSettings || !screenInfo) {
            if (!this.joinedStream) {
                this.joinedStream = true;
                this.applyNewVideoSettings(currentSettings);
                this.requestProfile(currentSettings);
            }
            return;
        }

        this.clientsCount = info.connectionCount;
        const oldInfo = this.player.getScreenInfo();
        if (!screenInfo.equals(oldInfo)) {
            this.player.setScreenInfo(screenInfo);
        }

        if (!videoSettings.equals(this.player.getVideoSettings())) {
            this.applyNewVideoSettings(videoSettings);
        }
        if (this.joinedStream) {
            return;
        }
        let initialProfile = videoSettings;
        if (applySavedProfile) {
            initialProfile = currentSettings;
        } else if (!oldInfo) {
            const bounds = currentSettings.bounds;
            const videoSize: Size = screenInfo.videoSize;
            const onlyOneClient = this.clientsCount === 0;
            const smallerThanCurrent = bounds && (bounds.width < videoSize.width || bounds.height < videoSize.height);
            if (onlyOneClient || smallerThanCurrent) {
                initialProfile = currentSettings;
            }
            const minBounds = currentSettings.bounds?.intersect(initialProfile.bounds);
            if (minBounds && !minBounds.equals(initialProfile.bounds)) {
                initialProfile = StreamClientScrcpy.createVideoSettingsWithBounds(initialProfile, minBounds);
            }
        }
        this.joinedStream = true;
        this.requestProfile(initialProfile);
    };

    private onConnected = (): void => this.recovery.connected();

    private onDisconnected = (): void => this.recovery.failed('投屏连接已断开');

    private onFirstFrame = (): void => this.recovery.presented();

    private onPlaybackError = (error: unknown): void => {
        console.warn(TAG, '播放失败', error);
        this.recovery.failed('视频解码或播放失败');
    };

    private connectStream(): void {
        this.joinedStream = false;
        this.clientId = this.clientsCount = -1;
        const player = this.player;
        if (!player) {
            return;
        }
        if (this.desiredProfile) {
            this.moreBox?.setRequestedProfile(this.desiredProfile);
            this.applyNewVideoSettings(this.desiredProfile);
        }
        try {
            const receiver = (this.streamReceiver ??= new StreamReceiverScrcpy(this.params));
            receiver.on('connected', this.onConnected);
            receiver.on('deviceMessage', this.OnDeviceMessage);
            receiver.on('video', this.onVideo);
            receiver.on('clientsStats', this.onClientsStats);
            receiver.on('displayInfo', this.onDisplayInfo);
            receiver.on('disconnected', this.onDisconnected);
            if (receiver.hasConnection()) {
                this.onConnected();
                receiver.triggerInitialInfoEvents();
            }
        } catch (error) {
            console.warn(TAG, '连接失败', error);
            this.recovery.failed('无法连接投屏服务');
        }
    }

    private disconnectStream(): void {
        const receiver = this.streamReceiver;
        this.streamReceiver = undefined;
        if (receiver) {
            receiver.off('connected', this.onConnected);
            receiver.off('deviceMessage', this.OnDeviceMessage);
            receiver.off('video', this.onVideo);
            receiver.off('clientsStats', this.onClientsStats);
            receiver.off('displayInfo', this.onDisplayInfo);
            receiver.off('disconnected', this.onDisconnected);
            receiver.stop();
        }
        this.filePushHandler?.release();
        this.filePushHandler = undefined;
        this.touchHandler?.release();
        this.touchHandler = undefined;
        KeyInputHandler.removeEventListener(this);
        clearTimeout(this.profileTimer);
        this.requestedProfile = this.reportedProfile = undefined;
        this.moreBox?.setProfileStatus('等待连接后读取画质设置。');
        this.moreBox?.clearStreamReport();
        this.player?.resetForStream();
        this.applyProfileOnJoin = true;
    }

    private async sessionExpired(): Promise<boolean> {
        const url = new URL(this.params.ws);
        if (
            !this.params.useProxy &&
            (url.host !== location.host || (url.protocol === 'wss:') !== (location.protocol === 'https:'))
        ) {
            return false;
        }
        const response = await fetch('session', { cache: 'no-store', redirect: 'manual' });
        return response.status === 401;
    }

    private showStreamStatus(status: StreamStatus): void {
        const holder = this.streamStatus;
        if (!holder) {
            return;
        }
        if (status.state === 'retrying' && this.retryMessage) {
            this.retryMessage.textContent = `${status.reason}，${status.seconds} 秒后重连…`;
            return;
        }
        this.retryMessage = undefined;
        if (status.state === 'playing') {
            holder.hidden = true;
            this.moreBox?.setConnectionMetrics(status.firstFrameMs, status.reconnects);
            const player = this.player;
            if (player && this.streamReceiver) {
                this.setTouchListeners(player);
                const element = player.getTouchableElement();
                this.filePushHandler = new FilePushHandler(element, new ScrcpyFilePushStream(this.streamReceiver));
                this.filePushHandler.addEventListener(new DragAndPushLogger(element));
                this.setHandleKeyboardEvents(this.keyboardEnabled);
            }
            return;
        }
        holder.hidden = false;
        const message = document.createElement('p');
        if (status.state === 'connecting' || status.state === 'first-frame') {
            const spinner = document.createElement('span');
            spinner.className = 'stream-spinner';
            spinner.setAttribute('aria-hidden', 'true');
            message.textContent = status.state === 'connecting' ? '正在连接投屏服务…' : '已连接投屏服务，正在等待首帧…';
            holder.replaceChildren(spinner, message);
            return;
        }
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = '立即重连';
        retry.onclick = () => this.recovery.retry();
        const actions = document.createElement('div');
        actions.className = 'stream-status-actions';
        actions.append(retry);
        if (status.state === 'retrying') {
            this.retryMessage = message;
            message.textContent = `${status.reason}，${status.seconds} 秒后重连…`;
            const pause = document.createElement('button');
            pause.type = 'button';
            pause.className = 'secondary-button';
            pause.textContent = '暂停自动重连';
            pause.onclick = () => this.recovery.pause();
            actions.append(pause);
        } else if (status.state === 'paused') {
            message.textContent = `${status.reason}，已暂停自动重连。`;
        } else {
            message.textContent = '登录已失效，请重新登录后重连。';
            const login = document.createElement('a');
            login.href = new URL('login', location.href).href;
            login.target = '_blank';
            login.rel = 'noopener';
            login.textContent = '重新登录';
            actions.prepend(login);
        }
        const back = document.createElement('a');
        back.href = location.pathname;
        back.textContent = '返回设备列表';
        back.onclick = () => this.stopStream();
        holder.replaceChildren(message, actions, back);
    }

    private stopStream(): void {
        this.recovery.stop();
        this.fullscreen?.dispose();
        this.moreBox?.dispose();
        this.player?.off('first-frame', this.onFirstFrame);
        this.player?.off('playback-error', this.onPlaybackError);
        this.player?.stop();
        window.removeEventListener('resize', this.onWindowResize);
        window.removeEventListener('pagehide', this.onPageHide);
        window.removeEventListener('pageshow', this.onPageShow);
        window.removeEventListener('offline', this.onOffline);
        window.removeEventListener('online', this.onOnline);
        clearTimeout(this.resizeTimeoutId);
    }

    private onPageHide = (event: PageTransitionEvent): void => {
        if (event.persisted) {
            this.suspended = this.recovery.suspend();
        } else {
            this.stopStream();
        }
    };

    private onPageShow = (event: PageTransitionEvent): void => {
        if (event.persisted && this.suspended) {
            this.suspended = false;
            this.recovery.retry();
        }
    };

    private onOffline = (): void => this.recovery.failed('浏览器网络已断开');

    private onOnline = (): void => this.recovery.networkRestored();

    public startStream({ udid, player, playerName, videoSettings, fitToScreen }: StartParams): void {
        if (!udid) {
            throw Error(`Invalid udid value: "${udid}"`);
        }

        if (!player) {
            if (typeof playerName !== 'string') {
                throw Error('Must provide BasePlayer instance or playerName');
            }
            let displayInfo: DisplayInfo | undefined;
            if (this.streamReceiver && videoSettings) {
                displayInfo = this.streamReceiver.getDisplayInfo(videoSettings.displayId);
            }
            const p = StreamClientScrcpy.createPlayer(playerName, udid, displayInfo);
            if (!p) {
                throw Error(`Unsupported player: "${playerName}"`);
            }
            if (typeof fitToScreen !== 'boolean') {
                fitToScreen = StreamClientScrcpy.getFitToScreen(playerName, udid, displayInfo);
            }
            player = p;
        }
        this.fitToScreen = fitToScreen;
        this.player = player;
        this.applyProfileOnJoin = !!videoSettings || player.hasSavedPreference();

        if (!videoSettings) {
            videoSettings = player.getVideoSettings();
        }

        const deviceView = document.createElement('div');
        deviceView.className = 'device-view';
        try {
            if (localStorage.getItem('ws_scrcpy::eink_mode') === '1') {
                deviceView.classList.add('eink-mode');
            }
        } catch {
            // ignore storage errors
        }
        this.fullscreen = new StreamFullscreen(deviceView, () => this.player?.getScreenInfo()?.videoSize);
        deviceView.tabIndex = -1;
        const stop = (ev?: string | Event) => {
            if (ev && ev instanceof Event && ev.type === 'error') {
                console.error(TAG, ev);
            }
            let parent;
            parent = deviceView.parentElement;
            if (parent) {
                parent.removeChild(deviceView);
            }
            parent = moreBox.parentElement;
            if (parent) {
                parent.removeChild(moreBox);
            }
            this.stopStream();
            window.location.assign(location.pathname);
        };

        const googMoreBox = (this.moreBox = new GoogMoreBox(udid, player, this));
        const moreBox = googMoreBox.getHolderElement();
        googMoreBox.setOnStop(stop);
        const isCompact = new URLSearchParams(location.search).get('compact') === '1';
        const googToolBox = GoogToolBox.createToolBox(udid, player, this, googMoreBox, {
            captureKeyboard: this.params.captureKeyboard,
            onBack: isCompact ? undefined : stop,
        });
        deviceView.appendChild(googToolBox.getHolderElement());
        const video = (this.videoViewport = document.createElement('div'));
        video.className = 'video';
        const status = (this.streamStatus = document.createElement('div'));
        status.className = 'stream-status';
        status.setAttribute('role', 'status');
        video.append(status);
        deviceView.appendChild(video);
        deviceView.appendChild(moreBox);
        player.setParent(video);
        player.pause();

        document.body.appendChild(deviceView);
        if (fitToScreen) {
            const newBounds = this.getMaxSize();
            if (newBounds) {
                videoSettings = StreamClientScrcpy.createVideoSettingsWithBounds(videoSettings, newBounds);
            }
        }
        this.desiredProfile = videoSettings;
        player.on('first-frame', this.onFirstFrame);
        player.on('playback-error', this.onPlaybackError);
        console.log(TAG, player.getName(), udid);

        // When the player is in fit-to-screen mode, re-encode the stream at the
        // new container size on window resize (debounced) so it stays crisp
        // instead of being CSS-scaled. Inert when the user picked a fixed
        // resolution.
        window.addEventListener('resize', this.onWindowResize);
        window.addEventListener('pagehide', this.onPageHide);
        window.addEventListener('pageshow', this.onPageShow);
        window.addEventListener('offline', this.onOffline);
        window.addEventListener('online', this.onOnline);
        this.recovery.start();
    }

    private resizeTimeoutId?: ReturnType<typeof setTimeout>;

    private onWindowResize = (): void => {
        if (this.resizeTimeoutId !== undefined) {
            clearTimeout(this.resizeTimeoutId);
        }
        this.resizeTimeoutId = setTimeout(this.applyFitToScreenBounds, 300);
    };

    private applyFitToScreenBounds = (): void => {
        this.resizeTimeoutId = undefined;
        if (!this.player || !this.fitToScreen || this.player.getState() === BasePlayer.STATE.STOPPED) {
            return;
        }
        const newBounds = this.getMaxSize();
        if (!newBounds) {
            return;
        }
        const current = this.desiredProfile ?? this.player.getVideoSettings();
        if (current.bounds && current.bounds.equals(newBounds)) {
            return;
        }
        const updated = StreamClientScrcpy.createVideoSettingsWithBounds(current, newBounds);
        this.sendNewVideoSetting(updated, false);
    };

    public sendMessage(message: ControlMessage): void {
        if (this.recovery.isPlaying && this.streamReceiver?.hasConnection()) {
            this.streamReceiver.sendEvent(message);
        }
    }

    public getDeviceName(): string {
        return this.deviceName;
    }

    public enterFullscreen(): void {
        void this.fullscreen?.enter();
    }

    public setHandleKeyboardEvents(enabled: boolean): void {
        this.keyboardEnabled = enabled;
        if (enabled && this.recovery.isPlaying) {
            KeyInputHandler.addEventListener(this);
        } else {
            KeyInputHandler.removeEventListener(this);
        }
    }

    public onKeyEvent(event: KeyCodeControlMessage): void {
        this.sendMessage(event);
    }

    public sendNewVideoSetting(videoSettings: VideoSettings, save = true): void {
        if (save) {
            this.player?.savePreference(videoSettings, this.fitToScreen ?? false);
        }
        this.requestProfile(videoSettings);
    }

    private requestProfile(profile: VideoSettings): void {
        clearTimeout(this.profileTimer);
        this.desiredProfile = profile;
        this.requestedProfile = profile;
        this.moreBox?.setRequestedProfile(profile);
        if (!this.streamReceiver?.hasConnection()) {
            this.moreBox?.setProfileStatus('画质设置将在重连后应用。');
            return;
        }
        this.moreBox?.setProfileStatus('正在等待设备确认画质设置…');
        this.streamReceiver.sendEvent(CommandControlMessage.createSetVideoSettingsCommand(profile));
        if (!this.reportedProfile || !this.confirmProfile(this.reportedProfile)) {
            this.profileTimer = setTimeout(() => {
                this.moreBox?.setProfileStatus('设备未回报相同的画质设置，请对比请求值和设备回报。');
            }, 5000);
        }
    }

    private confirmProfile(profile: VideoSettings): boolean {
        const requested = this.requestedProfile;
        if (!requested?.equals(profile)) {
            return false;
        }
        clearTimeout(this.profileTimer);
        this.requestedProfile = undefined;
        this.moreBox?.setProfileStatus('设备已确认请求的画质设置');
        return true;
    }

    public getClientId(): number {
        return this.clientId;
    }

    public getClientsCount(): number {
        return this.clientsCount;
    }

    public getMaxSize(): Size | undefined {
        if (!this.videoViewport) {
            return;
        }
        const width = this.videoViewport.clientWidth & ~15;
        const height = this.videoViewport.clientHeight & ~15;
        return width && height ? new Size(width, height) : undefined;
    }

    private setTouchListeners(player: BasePlayer): void {
        if (this.touchHandler) {
            return;
        }
        this.touchHandler = new FeaturedInteractionHandler(player, this);
    }

    private applyNewVideoSettings(videoSettings: VideoSettings): void {
        this.player?.setVideoSettings(videoSettings, this.fitToScreen ?? false, false);
    }

    public static createEntryForDeviceList(
        descriptor: GoogDeviceDescriptor,
        blockClass: string,
        fullName: string,
        params: ParamsDeviceTracker,
    ): HTMLElement | DocumentFragment | undefined {
        const hasPid = descriptor.pid !== -1;
        if (hasPid) {
            const configureButtonId = `configure_${Util.escapeUdid(descriptor.udid)}`;
            const e = html`<div class="stream ${blockClass}">
                <button
                    ${Attribute.UDID}="${descriptor.udid}"
                    ${Attribute.COMMAND}="${ControlCenterCommand.CONFIGURE_STREAM}"
                    ${Attribute.FULL_NAME}="${fullName}"
                    ${Attribute.SECURE}="${params.secure}"
                    ${Attribute.HOSTNAME}="${params.hostname}"
                    ${Attribute.PORT}="${params.port}"
                    ${Attribute.PATHNAME}="${params.pathname}"
                    ${Attribute.USE_PROXY}="${params.useProxy}"
                    id="${configureButtonId}"
                    class="active action-button"
                >
                    投屏设置
                </button>
            </div>`;
            const a = e.content.getElementById(configureButtonId);
            a && (a.onclick = this.onConfigureStreamClick);
            return e.content;
        }
        return;
    }

    private static onConfigureStreamClick = async (event: MouseEvent): Promise<void> => {
        const button = event.currentTarget as HTMLButtonElement;
        const udid = Util.parseStringEnv(button.getAttribute(Attribute.UDID) || '');
        const fullName = button.getAttribute(Attribute.FULL_NAME);
        const secure = Util.parseBooleanEnv(button.getAttribute(Attribute.SECURE) || undefined) || false;
        const hostname = Util.parseStringEnv(button.getAttribute(Attribute.HOSTNAME) || undefined) || '';
        const port = Util.parseIntEnv(button.getAttribute(Attribute.PORT) || undefined);
        const pathname = Util.parseStringEnv(button.getAttribute(Attribute.PATHNAME) || undefined) || '';
        const useProxy = Util.parseBooleanEnv(button.getAttribute(Attribute.USE_PROXY) || undefined);
        if (!udid) {
            throw Error(`Invalid udid value: "${udid}"`);
        }
        if (typeof port !== 'number') {
            throw Error(`Invalid port type: ${typeof port}`);
        }
        const tracker = DeviceTracker.getInstance({
            type: 'android',
            secure,
            hostname,
            port,
            pathname,
            useProxy,
        });
        const descriptor = tracker.getDescriptorByUdid(udid);
        if (!descriptor) {
            return;
        }
        event.preventDefault();
        const elements = document.getElementsByName(`${DeviceTracker.AttributePrefixInterfaceSelectFor}${fullName}`);
        if (!elements || !elements.length) {
            return;
        }
        const select = elements[0] as HTMLSelectElement;
        const optionElement = select.options[select.selectedIndex];
        const ws = optionElement.getAttribute(Attribute.URL);
        const name = optionElement.getAttribute(Attribute.NAME);
        if (!ws || !name) {
            return;
        }
        const options: ParamsStreamScrcpy = {
            udid,
            ws,
            player: '',
            action: ACTION.STREAM_SCRCPY,
            secure,
            hostname,
            port,
            pathname,
            useProxy,
        };
        button.disabled = true;
        try {
            const players = await this.loadPlayers();
            if (!button.isConnected) {
                return;
            }
            if (!players.length) {
                button.textContent = '无法加载播放器 · 重试';
                return;
            }
            button.textContent = '投屏设置';
            const dialog = new ConfigureScrcpy(tracker, descriptor, options, players);
            dialog.on('closed', StreamClientScrcpy.onConfigureDialogClosed);
        } finally {
            button.disabled = false;
        }
    };

    private static onConfigureDialogClosed = (event: { dialog: ConfigureScrcpy; result: boolean }): void => {
        event.dialog.off('closed', StreamClientScrcpy.onConfigureDialogClosed);
        if (event.result) {
            HostTracker.getInstance().destroy();
        }
    };
}
