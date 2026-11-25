import { BasePlayer } from './BasePlayer';
import VideoConverter, { setLogger, mimeType } from 'h264-converter';
import VideoSettings from '../VideoSettings';
import Size from '../Size';
import { DisplayInfo } from '../DisplayInfo';

interface QualityStats {
    timestamp: number;
    decodedFrames: number;
    droppedFrames: number;
}

const BUFFER_CHECK_INTERVAL_MS = 100;
const CATCH_UP_THRESHOLD = 0.35;
const NORMAL_PLAYBACK_THRESHOLD = 0.2;
const HARD_SEEK_THRESHOLD = 1.5;
const LIVE_EDGE_MARGIN = 0.15;
const STALL_TIMEOUT_MS = 750;
const SEEK_COOLDOWN_MS = 1000;
const KEEP_BEHIND_SECONDS = 20;

export class MsePlayer extends BasePlayer {
    public static readonly storageKeyPrefix = 'MseDecoder';
    public static readonly playerFullName = 'H264 Converter';
    public static readonly playerCodeName = 'mse';
    public static readonly preferredVideoSettings: VideoSettings = new VideoSettings({
        lockedVideoOrientation: -1,
        bitrate: 8_000_000,
        maxFps: 30,
        iFrameInterval: 2,
        bounds: new Size(1280, 1280),
        sendFrameMeta: false,
    });
    private static DEFAULT_FRAMES_PER_FRAGMENT = 1;
    private static DEFAULT_FRAMES_PER_SECOND = 30;

    public static createElement(id?: string): HTMLVideoElement {
        const tag = document.createElement('video') as HTMLVideoElement;
        tag.muted = true;
        tag.autoplay = true;
        tag.playsInline = true;
        tag.setAttribute('muted', 'muted');
        tag.setAttribute('autoplay', 'autoplay');
        if (typeof id === 'string') {
            tag.id = id;
        }
        tag.className = 'video-layer';
        return tag;
    }

    private converter?: VideoConverter;
    private videoStats: QualityStats[] = [];
    public fpf: number = MsePlayer.DEFAULT_FRAMES_PER_FRAGMENT;
    public readonly supportsScreenshot = true;
    private sourceBuffer?: SourceBuffer;
    private prunePoints: number[] = [];
    private nextBufferCheck = 0;
    private lastPosition = -1;
    private lastProgressAt = 0;
    private lastSeekAt = -Infinity;

    public static isSupported(): boolean {
        return typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(mimeType);
    }

    constructor(
        udid: string,
        displayInfo?: DisplayInfo,
        name = MsePlayer.playerFullName,
        protected tag: HTMLVideoElement = MsePlayer.createElement(),
    ) {
        super(udid, displayInfo, name, MsePlayer.storageKeyPrefix, tag);
        tag.oncontextmenu = function (event: MouseEvent): boolean {
            event.preventDefault();
            return false;
        };
        tag.addEventListener('error', this.onVideoError);
        tag.addEventListener('canplay', this.onCanPlay);
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        setLogger(() => {}, console.error);
    }

    onVideoError = (event: Event): void => {
        console.error(`[${this.name}]`, event);
    };

    private onCanPlay = (): void => {
        if (!this.converter || this.getState() !== BasePlayer.STATE.PLAYING) {
            return;
        }
        this.watchSourceBuffer();
        this.checkVideoResize();
        if (this.tag.paused) {
            void this.tag.play().catch((error: Error) => {
                if (error.name !== 'AbortError') {
                    console.warn(`[${this.name}]`, error.message);
                }
            });
        }
    };

    private static createConverter(
        tag: HTMLVideoElement,
        fps: number = MsePlayer.DEFAULT_FRAMES_PER_SECOND,
        fpf: number = MsePlayer.DEFAULT_FRAMES_PER_FRAGMENT,
    ): VideoConverter {
        return new VideoConverter(tag, fps, fpf);
    }

    private getVideoPlaybackQuality(): QualityStats | null {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const video = this.tag as any;
        if (typeof video.mozDecodedFrames !== 'undefined') {
            return null;
        }
        const now = Date.now();
        if (typeof this.tag.getVideoPlaybackQuality == 'function') {
            const temp = this.tag.getVideoPlaybackQuality();
            return {
                timestamp: now,
                decodedFrames: temp.totalVideoFrames,
                droppedFrames: temp.droppedVideoFrames,
            };
        }

        // Webkit-specific properties
        if (typeof video.webkitDecodedFrameCount !== 'undefined') {
            return {
                timestamp: now,
                decodedFrames: video.webkitDecodedFrameCount,
                droppedFrames: video.webkitDroppedFrameCount,
            };
        }
        return null;
    }

    protected calculateMomentumStats(): void {
        const stat = this.getVideoPlaybackQuality();
        if (!stat) {
            return;
        }

        const timestamp = Date.now();
        const oneSecondBefore = timestamp - 1000;
        this.videoStats.push(stat);

        while (this.videoStats.length && this.videoStats[0].timestamp < oneSecondBefore) {
            this.videoStats.shift();
        }
        let inputBytes = 0;
        this.inputBytes.forEach((item) => {
            inputBytes += item.bytes;
        });
        const inputFrames = this.inputBytes.length;
        if (this.videoStats.length) {
            const oldest = this.videoStats[0];
            const decodedFrames = stat.decodedFrames - oldest.decodedFrames;
            const droppedFrames = stat.droppedFrames - oldest.droppedFrames;
            // const droppedFrames = inputFrames - decodedFrames;
            this.momentumQualityStats = {
                decodedFrames,
                droppedFrames,
                inputBytes,
                inputFrames,
                timestamp,
            };
        }
    }

    protected resetStats(): void {
        super.resetStats();
        this.videoStats = [];
    }

    public getImageDataURL(): string {
        const canvas = document.createElement('canvas');
        canvas.width = this.tag.clientWidth;
        canvas.height = this.tag.clientHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(this.tag, 0, 0, canvas.width, canvas.height);
        }

        return canvas.toDataURL();
    }

    public play(): void {
        super.play();
        if (this.getState() !== BasePlayer.STATE.PLAYING) {
            return;
        }
        if (!this.converter) {
            let fps = MsePlayer.DEFAULT_FRAMES_PER_SECOND;
            if (this.videoSettings) {
                fps = this.videoSettings.maxFps;
            }
            this.converter = MsePlayer.createConverter(this.tag, fps, this.fpf);
            this.resetStats();
        }
    }

    public pause(): void {
        super.pause();
        this.stopConverter();
    }

    public stop(): void {
        super.stop();
        this.stopConverter();
    }

    public setVideoSettings(videoSettings: VideoSettings, fitToScreen: boolean, saveToStorage: boolean): void {
        const restart = this.converter && this.videoSettings.maxFps !== videoSettings.maxFps;
        if (restart) {
            this.stopConverter();
        }
        super.setVideoSettings(videoSettings, fitToScreen, saveToStorage);
        if (restart && this.getState() === BasePlayer.STATE.PLAYING) {
            this.play();
        }
    }

    public getPreferredVideoSetting(): VideoSettings {
        return MsePlayer.preferredVideoSettings;
    }

    checkVideoResize = (): void => {
        if (!this.tag) {
            return;
        }
        const { videoHeight, videoWidth } = this.tag;
        if (videoWidth && videoHeight && (this.videoHeight !== videoHeight || this.videoWidth !== videoWidth)) {
            this.calculateScreenInfoForBounds(videoWidth, videoHeight);
        }
    };
    private watchSourceBuffer(): void {
        const sourceBuffer = this.converter?.sourceBuffer;
        if (sourceBuffer && this.sourceBuffer !== sourceBuffer) {
            this.sourceBuffer?.removeEventListener('updateend', this.onBufferUpdated);
            this.sourceBuffer = sourceBuffer;
            sourceBuffer.addEventListener('updateend', this.onBufferUpdated);
        }
    }

    private onBufferUpdated = (): void => {
        this.pruneBuffer(this.tag.currentTime);
        const now = performance.now();
        if (now < this.nextBufferCheck) {
            return;
        }
        this.nextBufferCheck = now + BUFFER_CHECK_INTERVAL_MS;
        this.checkVideoResize();
        const { buffered, currentTime, seeking, paused, readyState } = this.tag;
        if (!buffered.length || seeking) {
            return;
        }
        const latestRange = buffered.length - 1;
        const start = buffered.start(latestRange);
        const end = buffered.end(latestRange);
        const delay = end - currentTime;
        if (currentTime !== this.lastPosition || paused || delay <= NORMAL_PLAYBACK_THRESHOLD) {
            this.lastPosition = currentTime;
            this.lastProgressAt = now;
        }
        const stalled = !paused && now - this.lastProgressAt >= STALL_TIMEOUT_MS;
        const target = Math.max(start, end - LIVE_EDGE_MARGIN);
        if (
            readyState >= HTMLMediaElement.HAVE_METADATA &&
            (delay > HARD_SEEK_THRESHOLD || stalled) &&
            target > currentTime + LIVE_EDGE_MARGIN &&
            now - this.lastSeekAt >= SEEK_COOLDOWN_MS
        ) {
            this.tag.playbackRate = 1;
            this.tag.currentTime = target;
            this.lastSeekAt = this.lastProgressAt = now;
            return;
        }
        if (delay <= NORMAL_PLAYBACK_THRESHOLD && this.tag.playbackRate !== 1) {
            this.tag.playbackRate = 1;
        } else if (!paused && delay > CATCH_UP_THRESHOLD && this.tag.playbackRate === 1) {
            this.tag.playbackRate = 1.15;
        }
    };

    private pruneBuffer(position: number): void {
        const sourceBuffer = this.sourceBuffer;
        const cutoff = position - KEEP_BEHIND_SECONDS;
        const firstPoint = this.prunePoints[0];
        if (firstPoint === undefined || firstPoint > cutoff) {
            return;
        }
        if (!sourceBuffer || sourceBuffer.updating || this.tag.error) {
            return;
        }
        const { buffered } = this.tag;
        if (!buffered.length) {
            return;
        }
        const bufferStart = buffered.start(0);
        let pruneEnd = bufferStart;
        while (this.prunePoints.length && this.prunePoints[0] <= cutoff) {
            pruneEnd = Math.max(pruneEnd, this.prunePoints[0]);
            this.prunePoints.shift();
        }
        if (pruneEnd > bufferStart) {
            sourceBuffer.remove(bufferStart, pruneEnd);
        }
    }

    public pushFrame(frame: Uint8Array): void {
        if (!this.converter) {
            return;
        }
        super.pushFrame(frame);
        this.watchSourceBuffer();
        if (BasePlayer.isIFrame(frame)) {
            const { buffered } = this.tag;
            if (buffered.length) {
                const end = buffered.end(buffered.length - 1);
                if (end > (this.prunePoints[this.prunePoints.length - 1] ?? 0)) {
                    this.prunePoints.push(end);
                }
            }
        }
        this.converter.appendRawData(frame);
    }

    private stopConverter(): void {
        if (!this.converter) {
            return;
        }
        this.sourceBuffer?.removeEventListener('updateend', this.onBufferUpdated);
        this.converter = this.sourceBuffer = undefined;
        this.prunePoints = [];
        this.nextBufferCheck = this.lastProgressAt = 0;
        this.lastPosition = -1;
        this.lastSeekAt = -Infinity;
        this.tag.pause();
        this.tag.playbackRate = 1;
        const src = this.tag.getAttribute('src');
        this.tag.removeAttribute('src');
        this.tag.load();
        if (src?.startsWith('blob:')) {
            URL.revokeObjectURL(src);
        }
    }

    protected getAdditionalQualityStats(): string[] {
        const { buffered, currentTime } = this.tag;
        if (!buffered.length) {
            return [];
        }
        const ahead = Math.max(0, buffered.end(buffered.length - 1) - currentTime);
        return [`Buffered ahead: ${Math.round(ahead * 1000)} ms`];
    }

    public getFitToScreenStatus(): boolean {
        return MsePlayer.getFitToScreenStatus(this.udid, this.displayInfo);
    }

    public loadVideoSettings(): VideoSettings {
        return MsePlayer.loadVideoSettings(this.udid, this.displayInfo);
    }
}
