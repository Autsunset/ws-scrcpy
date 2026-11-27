import VideoSettings from '../VideoSettings';
import ScreenInfo from '../ScreenInfo';
import Rect from '../Rect';
import Size from '../Size';
import Util from '../Util';
import { TypedEmitter } from '../../common/TypedEmitter';
import { DisplayInfo } from '../DisplayInfo';

interface BitrateStat {
    timestamp: number;
    bytes: number;
}

interface FramesPerSecondStats {
    avgInput: number;
    avgDecoded: number;
    avgDropped: number;
    avgSize: number;
}

export interface PlaybackQuality {
    decodedFrames: number;
    droppedFrames: number;
    inputFrames: number;
    inputBytes: number;
    timestamp: number;
}

export interface PlayerEvents {
    'video-view-resize': Size;
    'input-video-resize': ScreenInfo;
    'video-settings': VideoSettings;
    'first-frame': void;
    'playback-error': unknown;
}

export interface PlayerClass {
    playerFullName: string;
    playerCodeName: string;
    storageKeyPrefix: string;
    isSupported(): boolean;
    getPreferredVideoSetting(): VideoSettings;
    getFitToScreenStatus(deviceName: string, displayInfo?: DisplayInfo): boolean;
    loadVideoSettings(deviceName: string, displayInfo?: DisplayInfo): VideoSettings;
    saveVideoSettings(
        deviceName: string,
        videoSettings: VideoSettings,
        fitToScreen: boolean,
        displayInfo?: DisplayInfo,
    ): void;
    new (udid: string, displayInfo?: DisplayInfo): BasePlayer;
}

export abstract class BasePlayer extends TypedEmitter<PlayerEvents> {
    private static readonly STAT_BACKGROUND: string = 'rgba(0, 0, 0, 0.5)';
    private static readonly STAT_TEXT_COLOR: string = 'hsl(24, 85%, 50%)';
    private static readonly QUALITY_SAMPLE_INTERVAL_MS = 250;
    public static readonly DEFAULT_SHOW_QUALITY_STATS = false;
    public static STATE: Record<string, number> = {
        PLAYING: 1,
        PAUSED: 2,
        STOPPED: 3,
    };
    private static STATS_HEIGHT = 12;
    protected screenInfo?: ScreenInfo;
    protected videoSettings: VideoSettings;
    protected parentElement?: HTMLElement;
    protected touchableCanvas: HTMLCanvasElement;
    protected inputBytes: BitrateStat[] = [];
    protected perSecondQualityStats?: FramesPerSecondStats;
    protected momentumQualityStats?: PlaybackQuality;
    protected bounds: Size | null = null;
    private totalStats: PlaybackQuality = {
        decodedFrames: 0,
        droppedFrames: 0,
        inputFrames: 0,
        inputBytes: 0,
        timestamp: 0,
    };
    private totalStatsCounter = 0;
    private dirtyStatsWidth = 0;
    private state: number = BasePlayer.STATE.STOPPED;
    private qualityTimer?: number;
    private showQualityStats = BasePlayer.DEFAULT_SHOW_QUALITY_STATS;
    protected receivedFirstFrame = false;
    private presentedFirstFrame = false;
    private statLines: string[] = [];
    public readonly supportsScreenshot: boolean = false;
    public readonly resizeVideoToBounds: boolean = false;
    protected videoHeight = -1;
    protected videoWidth = -1;

    public static storageKeyPrefix = 'BaseDecoder';
    public static playerFullName = 'BasePlayer';
    public static playerCodeName = 'baseplayer';
    public static preferredVideoSettings: VideoSettings = new VideoSettings({
        lockedVideoOrientation: -1,
        bitrate: 524288,
        maxFps: 24,
        iFrameInterval: 5,
        bounds: new Size(480, 480),
        sendFrameMeta: false,
    });

    public static isSupported(): boolean {
        // Implement the check in a child class
        return false;
    }

    constructor(
        public readonly udid: string,
        protected displayInfo?: DisplayInfo,
        protected name: string = 'BasePlayer',
        protected storageKeyPrefix: string = 'Dummy',
        protected tag: HTMLElement = document.createElement('div'),
    ) {
        super();
        this.touchableCanvas = document.createElement('canvas');
        this.touchableCanvas.className = 'touch-layer';
        this.touchableCanvas.oncontextmenu = function (event: MouseEvent): void {
            event.preventDefault();
        };
        const preferred = this.getPreferredVideoSetting();
        this.videoSettings = BasePlayer.getVideoSettingFromStorage(preferred, this.storageKeyPrefix, udid, displayInfo);
    }

    protected calculateScreenInfoForBounds(videoWidth: number, videoHeight: number): void {
        this.videoWidth = videoWidth;
        this.videoHeight = videoHeight;
        if (this.resizeVideoToBounds) {
            let w = videoWidth;
            let h = videoHeight;
            if (this.bounds) {
                let { w: boundsWidth, h: boundsHeight } = this.bounds;
                if (w > boundsWidth || h > boundsHeight) {
                    let scaledHeight;
                    let scaledWidth;
                    if (boundsWidth > w) {
                        scaledHeight = h;
                    } else {
                        scaledHeight = (boundsWidth * h) / w;
                    }
                    if (boundsHeight > scaledHeight) {
                        boundsHeight = scaledHeight;
                    }
                    if (boundsHeight == h) {
                        scaledWidth = w;
                    } else {
                        scaledWidth = (boundsHeight * w) / h;
                    }
                    if (boundsWidth > scaledWidth) {
                        boundsWidth = scaledWidth;
                    }
                    w = boundsWidth | 0;
                    h = boundsHeight | 0;
                    this.tag.style.maxWidth = `${w}px`;
                    this.tag.style.maxHeight = `${h}px`;
                }
            }
            const realScreen = new ScreenInfo(new Rect(0, 0, videoWidth, videoHeight), new Size(w, h), 0);
            this.emit('input-video-resize', realScreen);
            this.setScreenInfo(new ScreenInfo(new Rect(0, 0, w, h), new Size(w, h), 0));
        }
    }

    protected static isIFrame(frame: Uint8Array): boolean {
        // last 5 bits === 5: Coded slice of an IDR picture

        // https://www.ietf.org/rfc/rfc3984.txt
        // 1.3.  Network Abstraction Layer Unit Types
        // https://www.itu.int/rec/T-REC-H.264-201906-I/en
        // Table 7-1 – NAL unit type codes, syntax element categories, and NAL unit type classes
        return frame && frame.length > 4 && (frame[4] & 31) === 5;
    }

    private static getLegacyStorageKey(storageKeyPrefix: string, udid: string): string {
        const { innerHeight, innerWidth } = window;
        return `${storageKeyPrefix}:${udid}:${innerWidth}x${innerHeight}`;
    }

    private static getPreferenceKey(prefix: string, udid: string, displayId = DisplayInfo.DEFAULT_DISPLAY): string {
        return `ws-scrcpy:video:${prefix}:${udid}:${displayId}`;
    }

    public static getFromStorageCompat(prefix: string, udid: string, displayInfo?: DisplayInfo): string | null {
        const displayId = displayInfo?.displayId ?? DisplayInfo.DEFAULT_DISPLAY;
        return this.readPreference(prefix, udid, displayId);
    }

    private static readPreference(prefix: string, udid: string, displayId: number, suffix = ''): string | null {
        try {
            const storage = window.localStorage;
            const key = this.getPreferenceKey(prefix, udid, displayId) + suffix;
            const saved = storage.getItem(key);
            if (saved !== null) {
                return saved;
            }
            const legacyKey = this.getLegacyStorageKey(prefix, udid);
            const matches = (candidate: string, base: string): boolean => {
                const parts = candidate.slice(base.length).split(':');
                return candidate.startsWith(`${base}:`) && parts[1] === String(displayId) && /^\d+x\d+$/.test(parts[2]);
            };
            const candidates = Object.keys(storage).filter((candidate) => candidate.startsWith(`${prefix}:${udid}:`));
            const legacy = candidates
                .filter((candidate) => (suffix ? candidate.endsWith(suffix) : !candidate.endsWith(':fit')))
                .sort((first, second) => Number(second.startsWith(legacyKey)) - Number(first.startsWith(legacyKey)))
                .find((candidate) => {
                    const tail = candidate.slice(`${prefix}:${udid}:`.length);
                    const dimensions = tail.split(':')[0];
                    if (!/^\d+x\d+$/.test(dimensions)) {
                        return false;
                    }
                    const plain = `${prefix}:${udid}:${dimensions}`;
                    return (
                        matches(candidate, plain) ||
                        (displayId === DisplayInfo.DEFAULT_DISPLAY && candidate === plain + suffix)
                    );
                });
            if (legacy) {
                const value = storage.getItem(legacy);
                if (value !== null) {
                    storage.setItem(key, value);
                }
                return value;
            }
        } catch (error) {
            console.warn('无法读取本地画质设置', error);
        }
        return null;
    }

    public static getFitToScreenFromStorage(
        storageKeyPrefix: string,
        udid: string,
        displayInfo?: DisplayInfo,
    ): boolean {
        return this.readPreference(storageKeyPrefix, udid, displayInfo?.displayId ?? 0, ':fit') === 'true';
    }

    public static getVideoSettingFromStorage(
        preferred: VideoSettings,
        storageKeyPrefix: string,
        udid: string,
        displayInfo?: DisplayInfo,
    ): VideoSettings {
        const saved = this.getFromStorageCompat(storageKeyPrefix, udid, displayInfo);
        if (!saved) {
            return preferred;
        }
        let parsed;
        try {
            parsed = JSON.parse(saved);
        } catch {
            return preferred;
        }
        if (!parsed || typeof parsed !== 'object') {
            return preferred;
        }
        const {
            displayId,
            crop,
            bitrate,
            iFrameInterval,
            sendFrameMeta,
            lockedVideoOrientation,
            codecOptions,
            encoderName,
        } = parsed;

        // REMOVE `frameRate`
        const maxFps = isNaN(parsed.maxFps) ? parsed.frameRate : parsed.maxFps;
        // REMOVE `maxSize`
        let bounds: Size | null = null;
        if (!parsed.bounds || !Number.isFinite(parsed.bounds.width) || !Number.isFinite(parsed.bounds.height)) {
            if (!isNaN(parsed.maxSize)) {
                bounds = new Size(parsed.maxSize, parsed.maxSize);
            }
        } else {
            bounds = new Size(parsed.bounds.width, parsed.bounds.height);
        }
        return new VideoSettings({
            displayId: typeof displayId === 'number' ? displayId : 0,
            crop: crop ? new Rect(crop.left, crop.top, crop.right, crop.bottom) : preferred.crop,
            bitrate: Number.isSafeInteger(bitrate) && bitrate > 0 ? bitrate : preferred.bitrate,
            bounds: bounds !== null ? bounds : preferred.bounds,
            maxFps: Number.isSafeInteger(maxFps) && maxFps > 0 ? maxFps : preferred.maxFps,
            iFrameInterval: !isNaN(iFrameInterval) ? iFrameInterval : preferred.iFrameInterval,
            sendFrameMeta: typeof sendFrameMeta === 'boolean' ? sendFrameMeta : preferred.sendFrameMeta,
            lockedVideoOrientation: !isNaN(lockedVideoOrientation)
                ? lockedVideoOrientation
                : preferred.lockedVideoOrientation,
            codecOptions,
            encoderName,
        });
    }

    protected static putVideoSettingsToStorage(
        storageKeyPrefix: string,
        udid: string,
        videoSettings: VideoSettings,
        fitToScreen: boolean,
        displayInfo?: DisplayInfo,
    ): void {
        try {
            const displayId = displayInfo?.displayId ?? videoSettings.displayId;
            const key = this.getPreferenceKey(storageKeyPrefix, udid, displayId);
            window.localStorage.setItem(key, JSON.stringify(videoSettings));
            window.localStorage.setItem(`${key}:fit`, JSON.stringify(fitToScreen));
        } catch (error) {
            console.warn('无法保存本地画质设置', error);
        }
    }

    public abstract getImageDataURL(): string;

    public createScreenshot(deviceName: string): void {
        const a = document.createElement('a');
        a.href = this.getImageDataURL();
        a.download = `${deviceName} ${new Date().toLocaleString()}.png`;
        a.click();
    }

    public play(): void {
        if (this.needScreenInfoBeforePlay() && !this.screenInfo) {
            return;
        }
        this.state = BasePlayer.STATE.PLAYING;
    }

    public pause(): void {
        this.state = BasePlayer.STATE.PAUSED;
    }

    public stop(): void {
        this.state = BasePlayer.STATE.STOPPED;
        this.receivedFirstFrame = false;
        this.presentedFirstFrame = false;
        if (this.qualityTimer !== undefined) {
            window.clearTimeout(this.qualityTimer);
            this.qualityTimer = undefined;
        }
    }

    public resetForStream(): void {
        this.stop();
        this.screenInfo = undefined;
        this.resetStats();
        this.pause();
    }

    protected onFramePresented(): void {
        if (!this.presentedFirstFrame && this.getState() === BasePlayer.STATE.PLAYING) {
            this.presentedFirstFrame = true;
            this.emit('first-frame', undefined);
        }
    }

    public getState(): number {
        return this.state;
    }

    public pushFrame(frame: Uint8Array): void {
        this.receivedFirstFrame = true;
        this.inputBytes.push({
            timestamp: Date.now(),
            bytes: frame.byteLength,
        });
        if (this.qualityTimer === undefined && this.state !== BasePlayer.STATE.STOPPED) {
            this.scheduleQualitySample();
        }
    }

    public abstract getPreferredVideoSetting(): VideoSettings;
    protected abstract calculateMomentumStats(): void;

    public getTouchableElement(): HTMLCanvasElement {
        return this.touchableCanvas;
    }

    public getParent(): HTMLElement | undefined {
        return this.parentElement;
    }

    public setParent(parent: HTMLElement): void {
        this.parentElement = parent;
        parent.appendChild(this.tag);
        parent.appendChild(this.touchableCanvas);
    }

    protected needScreenInfoBeforePlay(): boolean {
        return true;
    }

    public getVideoSettings(): VideoSettings {
        return this.videoSettings;
    }

    public setVideoSettings(videoSettings: VideoSettings, fitToScreen: boolean, saveToStorage: boolean): void {
        this.videoSettings = videoSettings;
        if (saveToStorage) {
            this.savePreference(videoSettings, fitToScreen);
        }
        this.resetStats();
        this.emit('video-settings', VideoSettings.copy(videoSettings));
    }

    public savePreference(videoSettings: VideoSettings, fitToScreen: boolean): void {
        BasePlayer.putVideoSettingsToStorage(this.storageKeyPrefix, this.udid, videoSettings, fitToScreen);
    }

    public hasSavedPreference(): boolean {
        return BasePlayer.getFromStorageCompat(this.storageKeyPrefix, this.udid, this.displayInfo) !== null;
    }

    public getReceivedMbps(): number | undefined {
        const bytes = this.momentumQualityStats?.inputBytes;
        return bytes === undefined ? undefined : (bytes * 8) / 1_000_000;
    }

    public getScreenInfo(): ScreenInfo | undefined {
        return this.screenInfo;
    }

    public setScreenInfo(screenInfo: ScreenInfo): void {
        if (this.needScreenInfoBeforePlay()) {
            this.pause();
        }
        this.receivedFirstFrame = false;
        this.screenInfo = screenInfo;
        const { width, height } = screenInfo.videoSize;
        this.touchableCanvas.width = width;
        this.touchableCanvas.height = height;
        const size = new Size(width, height);
        this.emit('video-view-resize', size);
    }

    public getName(): string {
        return this.name;
    }

    protected resetStats(): void {
        this.receivedFirstFrame = false;
        this.inputBytes = [];
        this.momentumQualityStats = undefined;
        this.totalStatsCounter = 0;
        this.totalStats = {
            droppedFrames: 0,
            decodedFrames: 0,
            inputFrames: 0,
            inputBytes: 0,
            timestamp: 0,
        };
        this.perSecondQualityStats = {
            avgDecoded: 0,
            avgDropped: 0,
            avgInput: 0,
            avgSize: 0,
        };
    }

    private scheduleQualitySample(): void {
        this.qualityTimer = window.setTimeout(this.updateQualityStats, BasePlayer.QUALITY_SAMPLE_INTERVAL_MS);
    }

    private updateQualityStats = (): void => {
        this.qualityTimer = undefined;
        if (this.state !== BasePlayer.STATE.STOPPED) {
            this.scheduleQualitySample();
        }
        const now = Date.now();
        const oneSecondBefore = now - 1000;
        while (this.inputBytes.length && this.inputBytes[0].timestamp < oneSecondBefore) {
            this.inputBytes.shift();
        }
        this.calculateMomentumStats();
        if (!this.momentumQualityStats) {
            return;
        }
        if (this.totalStats.timestamp < oneSecondBefore) {
            this.totalStats = {
                timestamp: now,
                decodedFrames: this.totalStats.decodedFrames + this.momentumQualityStats.decodedFrames,
                droppedFrames: this.totalStats.droppedFrames + this.momentumQualityStats.droppedFrames,
                inputFrames: this.totalStats.inputFrames + this.momentumQualityStats.inputFrames,
                inputBytes: this.totalStats.inputBytes + this.momentumQualityStats.inputBytes,
            };

            this.totalStatsCounter++;
            this.perSecondQualityStats = {
                avgDecoded: this.totalStats.decodedFrames / this.totalStatsCounter,
                avgDropped: this.totalStats.droppedFrames / this.totalStatsCounter,
                avgInput: this.totalStats.inputFrames / this.totalStatsCounter,
                avgSize: this.totalStats.inputBytes / this.totalStatsCounter,
            };
        }
        this.drawStats();
    };

    protected getAdditionalQualityStats(): string[] {
        return [];
    }

    private drawStats(): void {
        if (!this.showQualityStats) {
            return;
        }
        const ctx = this.touchableCanvas.getContext('2d');
        if (!ctx) {
            return;
        }
        const newStats = [];
        if (this.perSecondQualityStats && this.momentumQualityStats) {
            const { decodedFrames, droppedFrames, inputBytes, inputFrames } = this.momentumQualityStats;
            const { avgDecoded, avgDropped, avgSize, avgInput } = this.perSecondQualityStats;
            const padInput = inputFrames.toString().padStart(3, ' ');
            const padDecoded = decodedFrames.toString().padStart(3, ' ');
            const padDropped = droppedFrames.toString().padStart(3, ' ');
            const padAvgDecoded = avgDecoded.toFixed(1).padStart(5, ' ');
            const padAvgDropped = avgDropped.toFixed(1).padStart(5, ' ');
            const padAvgInput = avgInput.toFixed(1).padStart(5, ' ');
            const prettyBytes = Util.prettyBytes(inputBytes).padStart(8, ' ');
            const prettyAvgBytes = Util.prettyBytes(avgSize).padStart(8, ' ');

            newStats.push(`Input bytes: ${prettyBytes} (avg: ${prettyAvgBytes}/s)`);
            newStats.push(`Input   FPS: ${padInput} (avg: ${padAvgInput})`);
            newStats.push(`Dropped FPS: ${padDropped} (avg: ${padAvgDropped})`);
            newStats.push(`Decoded FPS: ${padDecoded} (avg: ${padAvgDecoded})`);
        } else {
            newStats.push(`Not supported`);
        }
        newStats.push(...this.getAdditionalQualityStats());
        if (
            this.statLines.length !== newStats.length ||
            newStats.some((line, index) => line !== this.statLines[index])
        ) {
            this.statLines = newStats;
            this.updateCanvas(false);
        }
    }

    private updateCanvas(onlyClear: boolean): void {
        const ctx = this.touchableCanvas.getContext('2d');
        if (!ctx) {
            return;
        }

        const y = this.touchableCanvas.height;
        const height = BasePlayer.STATS_HEIGHT;
        const lines = this.statLines.length;
        const spaces = lines + 1;
        const p = height / 2;
        const d = p * 2;
        const totalHeight = height * lines + p * spaces;

        ctx.clearRect(0, y - totalHeight, this.dirtyStatsWidth + d, totalHeight);
        this.dirtyStatsWidth = 0;

        if (onlyClear) {
            return;
        }
        ctx.save();
        ctx.font = `${height}px monospace`;
        this.statLines.forEach((text) => {
            const textMetrics = ctx.measureText(text);
            const dirty = Math.abs(textMetrics.actualBoundingBoxLeft) + Math.abs(textMetrics.actualBoundingBoxRight);
            this.dirtyStatsWidth = Math.max(dirty, this.dirtyStatsWidth);
        });
        ctx.fillStyle = BasePlayer.STAT_BACKGROUND;
        ctx.fillRect(0, y - totalHeight, this.dirtyStatsWidth + d, totalHeight);
        ctx.fillStyle = BasePlayer.STAT_TEXT_COLOR;
        this.statLines.forEach((text, line) => {
            ctx.fillText(text, p, y - p - line * (height + p));
        });
        ctx.restore();
    }

    public setShowQualityStats(value: boolean): void {
        this.showQualityStats = value;
        if (!value) {
            this.updateCanvas(true);
            this.statLines = [];
        } else {
            this.drawStats();
        }
    }

    public getShowQualityStats(): boolean {
        return this.showQualityStats;
    }

    public setBounds(bounds: Size): void {
        this.bounds = Size.copy(bounds);
    }

    public getDisplayInfo(): DisplayInfo | undefined {
        return this.displayInfo;
    }

    public setDisplayInfo(displayInfo: DisplayInfo): void {
        this.displayInfo = displayInfo;
    }

    public abstract getFitToScreenStatus(): boolean;

    public abstract loadVideoSettings(): VideoSettings;

    public static loadVideoSettings(udid: string, displayInfo?: DisplayInfo): VideoSettings {
        return this.getVideoSettingFromStorage(this.preferredVideoSettings, this.storageKeyPrefix, udid, displayInfo);
    }

    public static getFitToScreenStatus(udid: string, displayInfo?: DisplayInfo): boolean {
        return this.getFitToScreenFromStorage(this.storageKeyPrefix, udid, displayInfo);
    }

    public static getPreferredVideoSetting(): VideoSettings {
        return this.preferredVideoSettings;
    }

    public static saveVideoSettings(
        udid: string,
        videoSettings: VideoSettings,
        fitToScreen: boolean,
        displayInfo?: DisplayInfo,
    ): void {
        this.putVideoSettingsToStorage(this.storageKeyPrefix, udid, videoSettings, fitToScreen, displayInfo);
    }
}
