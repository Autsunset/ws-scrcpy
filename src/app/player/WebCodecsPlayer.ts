import { BaseCanvasBasedPlayer } from './BaseCanvasBasedPlayer';
import VideoSettings from '../VideoSettings';
import Size from '../Size';
import { DisplayInfo } from '../DisplayInfo';
import H264Parser from 'h264-converter/dist/h264-parser';
import NALU from 'h264-converter/dist/util/NALU';
import ScreenInfo from '../ScreenInfo';
import Rect from '../Rect';

type ParametersSubSet = {
    codec: string;
    width: number;
    height: number;
};

function toHex(value: number) {
    return value.toString(16).padStart(2, '0').toUpperCase();
}

function annexBUnits(packet: Uint8Array): Uint8Array[] {
    const units: Uint8Array[] = [];
    let start = -1;
    let prefixLength = 0;
    for (let offset = 0; offset + 3 < packet.length; offset++) {
        if (packet[offset] || packet[offset + 1]) {
            continue;
        }
        const prefix = packet[offset + 2] === 1 ? 3 : packet[offset + 2] === 0 && packet[offset + 3] === 1 ? 4 : 0;
        if (!prefix) {
            continue;
        }
        if (start >= 0) {
            units.push(packet.subarray(start + prefixLength, offset));
        }
        start = offset;
        prefixLength = prefix;
        offset += prefix - 1;
    }
    if (start >= 0) {
        units.push(packet.subarray(start + prefixLength));
    }
    return units;
}

function packAnnexB(units: Uint8Array[]): Uint8Array {
    const bytes = new Uint8Array(units.reduce((length, unit) => length + 4 + unit.length, 0));
    let offset = 0;
    for (const unit of units) {
        bytes[offset + 3] = 1;
        bytes.set(unit, offset + 4);
        offset += 4 + unit.length;
    }
    return bytes;
}

export class WebCodecsPlayer extends BaseCanvasBasedPlayer {
    public static readonly storageKeyPrefix = 'WebCodecsPlayer';
    public static readonly playerFullName = 'WebCodecs';
    public static readonly playerCodeName = 'webcodecs';

    public static readonly preferredVideoSettings: VideoSettings = new VideoSettings({
        lockedVideoOrientation: -1,
        bitrate: 8_000_000,
        maxFps: 30,
        iFrameInterval: 2,
        bounds: new Size(1280, 1280),
        sendFrameMeta: false,
    });

    public static isSupported(): boolean {
        return typeof VideoDecoder === 'function' && typeof VideoDecoder.isConfigSupported === 'function';
    }

    private static parseSPS(data: Uint8Array): ParametersSubSet {
        const {
            profile_idc,
            constraint_set_flags,
            level_idc,
            pic_width_in_mbs_minus1,
            frame_crop_left_offset,
            frame_crop_right_offset,
            frame_mbs_only_flag,
            pic_height_in_map_units_minus1,
            frame_crop_top_offset,
            frame_crop_bottom_offset,
            sar,
        } = H264Parser.parseSPS(data);

        const sarScale = sar[0] / sar[1];
        const codec = `avc1.${[profile_idc, constraint_set_flags, level_idc].map(toHex).join('')}`;
        const width = Math.ceil(
            ((pic_width_in_mbs_minus1 + 1) * 16 - frame_crop_left_offset * 2 - frame_crop_right_offset * 2) * sarScale,
        );
        const height =
            (2 - frame_mbs_only_flag) * (pic_height_in_map_units_minus1 + 1) * 16 -
            (frame_mbs_only_flag ? 2 : 4) * (frame_crop_top_offset + frame_crop_bottom_offset);
        return { codec, width, height };
    }

    public readonly supportsScreenshot = true;
    private context: CanvasRenderingContext2D;
    private decoder: VideoDecoder;
    private configuration?: VideoDecoderConfig;
    private sps?: Uint8Array;
    private pps?: Uint8Array;
    private needsKeyFrame = true;
    private timestamp = -1;
    private queueRecoveries = 0;

    constructor(udid: string, displayInfo?: DisplayInfo, name = WebCodecsPlayer.playerFullName) {
        super(udid, displayInfo, name, WebCodecsPlayer.storageKeyPrefix);
        const context = this.tag.getContext('2d');
        if (!context) {
            throw Error('Failed to get 2d context from canvas');
        }
        this.context = context;
        this.decoder = this.createDecoder();
    }

    private createDecoder(): VideoDecoder {
        return new VideoDecoder({
            output: (frame) => {
                this.onFrameDecoded(0, 0, frame);
            },
            error: (error: DOMException) => {
                console.error(error, `code: ${error.code}`);
                this.stop();
            },
        });
    }

    protected scaleCanvas(width: number, height: number): void {
        const videoSize = new Size(width, height);
        let scale = 1;
        if (this.bounds && !this.bounds.intersect(videoSize).equals(videoSize)) {
            scale = Math.min(this.bounds.w / width, this.bounds.h / height);
        }
        const w = width * scale;
        const h = height * scale;
        const screenInfo = new ScreenInfo(new Rect(0, 0, width, height), new Size(w, h), 0);
        this.emit('input-video-resize', screenInfo);
        this.setScreenInfo(screenInfo);

        // FIXME: canvas was initialized from `.setScreenInfo()` call above, but with wrong values
        this.initCanvas(width, height);
        if (scale !== 1) {
            this.tag.style.transform = `scale(${scale.toFixed(4)})`;
        } else {
            this.tag.style.transform = ``;
        }
        this.tag.style.transformOrigin = 'top left';
    }

    protected decode(data: Uint8Array): void {
        if (data.length < 4) {
            return;
        }
        const units = annexBUnits(data);
        let key = false;
        let picture = false;
        for (const unit of units) {
            const type = unit[0] & 31;
            if (type === NALU.SPS) {
                this.updateSps(unit);
            } else if (type === NALU.PPS) {
                this.pps = unit;
            } else if (type === NALU.IDR || type === NALU.NDR) {
                key = key || type === NALU.IDR;
                picture = true;
            }
        }
        if (!picture || !this.configuration || this.decoder.state === 'closed') {
            return;
        }
        const maxQueued = Math.min(12, Math.max(4, Math.ceil(this.videoSettings.maxFps / 6)));
        if (this.decoder.decodeQueueSize >= maxQueued) {
            this.decoder.reset();
            this.clearState();
            this.needsKeyFrame = true;
            this.queueRecoveries++;
        }
        if (this.needsKeyFrame && !key) {
            return;
        }
        let bytes = data;
        if (key) {
            if (!this.sps || !this.pps) {
                return;
            }
            bytes = packAnnexB([
                this.sps,
                this.pps,
                ...units.filter((unit) => (unit[0] & 31) !== NALU.SPS && (unit[0] & 31) !== NALU.PPS),
            ]);
        }
        try {
            if (this.decoder.state === 'unconfigured') {
                this.decoder.configure(this.configuration);
            }
            this.timestamp = Math.max(this.timestamp + 1, Math.round(performance.now() * 1000));
            this.decoder.decode(
                new EncodedVideoChunk({
                    type: key ? 'key' : 'delta',
                    timestamp: this.timestamp,
                    data: bytes,
                }),
            );
            this.receivedFirstFrame = true;
            this.needsKeyFrame = false;
        } catch (error) {
            console.error(`[${this.name}]`, error);
            this.stop();
        }
    }

    private updateSps(unit: Uint8Array): void {
        if (this.sps?.length === unit.length && this.sps.every((value, index) => value === unit[index])) {
            return;
        }
        const { codec, width, height } = WebCodecsPlayer.parseSPS(unit);
        if (this.decoder.state === 'configured') {
            this.decoder.reset();
        }
        this.configuration = { codec, optimizeForLatency: true } as VideoDecoderConfig;
        this.sps = unit;
        this.needsKeyFrame = true;
        this.scaleCanvas(width, height);
    }

    protected maxDecodedFrames(): number {
        return 1;
    }

    protected getAdditionalQualityStats(): string[] {
        return [`Decoder queue: ${this.decoder.decodeQueueSize} · Resyncs: ${this.queueRecoveries}`];
    }

    protected drawDecoded = (): void => {
        if (this.receivedFirstFrame) {
            const data = this.decodedFrames.shift();
            if (data) {
                const frame: VideoFrame = data.frame;
                try {
                    this.context.drawImage(frame, 0, 0);
                } finally {
                    frame.close();
                }
            }
        }
        if (this.decodedFrames.length) {
            this.animationFrameId = requestAnimationFrame(this.drawDecoded);
        } else {
            this.animationFrameId = undefined;
        }
    };

    protected dropFrame(frame: VideoFrame): void {
        frame.close();
    }

    public getFitToScreenStatus(): boolean {
        return false;
    }

    public getPreferredVideoSetting(): VideoSettings {
        return WebCodecsPlayer.preferredVideoSettings;
    }

    public loadVideoSettings(): VideoSettings {
        return WebCodecsPlayer.loadVideoSettings(this.udid, this.displayInfo);
    }

    protected needScreenInfoBeforePlay(): boolean {
        return false;
    }

    public stop(): void {
        super.stop();
        if (this.decoder.state !== 'closed') {
            this.decoder.close();
        }
    }
}
