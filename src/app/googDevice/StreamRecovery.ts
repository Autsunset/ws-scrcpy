export type StreamStatus =
    | { state: 'connecting' | 'first-frame' | 'session-expired' }
    | { state: 'playing'; firstFrameMs: number; reconnects: number }
    | { state: 'retrying'; reason: string; seconds: number }
    | { state: 'paused'; reason: string };

interface StreamRecoveryHandlers {
    connect: () => void;
    disconnect: () => void;
    status: (status: StreamStatus) => void;
    sessionExpired: () => Promise<boolean>;
}

const CONNECT_TIMEOUT_MS = 10_000;
const FIRST_FRAME_TIMEOUT_MS = 12_000;
const MAX_RETRY_SECONDS = 30;

export class StreamRecovery {
    private state: StreamStatus['state'] | 'idle' | 'stopped' = 'idle';
    private timer?: ReturnType<typeof setTimeout>;
    private failedAttempts = 0;
    private reconnects = 0;
    private startedAt = 0;
    private generation = 0;
    private failureReason = '';

    constructor(private readonly handlers: StreamRecoveryHandlers) {}

    public get isPlaying(): boolean {
        return this.state === 'playing';
    }

    public start(): void {
        if (this.state !== 'idle') {
            return;
        }
        this.connect();
    }

    public connected(): void {
        if (this.state !== 'connecting') {
            return;
        }
        this.setStatus({ state: 'first-frame' });
        this.schedule(() => this.failed('等待画面超时'), FIRST_FRAME_TIMEOUT_MS);
    }

    public presented(): void {
        if (this.state !== 'first-frame') {
            return;
        }
        this.clearTimer();
        this.failedAttempts = 0;
        this.setStatus({
            state: 'playing',
            firstFrameMs: Math.round(performance.now() - this.startedAt),
            reconnects: this.reconnects,
        });
    }

    public failed(reason: string): void {
        if (this.state !== 'connecting' && this.state !== 'first-frame' && this.state !== 'playing') {
            return;
        }
        this.failureReason = reason;
        const generation = this.generation;
        const delay = Math.min(MAX_RETRY_SECONDS, 2 ** Math.min(this.failedAttempts++, 5));
        const deadline = performance.now() + delay * 1000;
        this.setStatus({ state: 'retrying', reason, seconds: delay });
        this.handlers.disconnect();
        const tick = () => {
            const remaining = deadline - performance.now();
            if (remaining <= 0) {
                this.retry();
                return;
            }
            this.setStatus({ state: 'retrying', reason, seconds: Math.ceil(remaining / 1000) });
            this.schedule(tick, Math.min(1000, remaining));
        };
        this.schedule(tick, 1000);
        void this.handlers.sessionExpired().then(
            (expired) => {
                if (
                    expired &&
                    this.generation === generation &&
                    (this.state === 'retrying' || this.state === 'paused')
                ) {
                    this.clearTimer();
                    this.setStatus({ state: 'session-expired' });
                }
            },
            () => undefined,
        );
    }

    public retry(): void {
        if (this.state === 'retrying' || this.state === 'paused' || this.state === 'session-expired') {
            this.reconnects++;
            this.connect();
        }
    }

    public networkRestored(): void {
        if (this.state === 'retrying') {
            this.retry();
        }
    }

    public pause(): void {
        if (this.state !== 'retrying') {
            return;
        }
        this.clearTimer();
        this.setStatus({ state: 'paused', reason: this.failureReason });
    }

    public suspend(): boolean {
        if (this.state === 'paused' || this.state === 'session-expired' || this.state === 'stopped') {
            return false;
        }
        this.failed('页面已暂停');
        this.pause();
        return true;
    }

    public stop(): void {
        if (this.state === 'stopped') {
            return;
        }
        this.state = 'stopped';
        this.generation++;
        this.clearTimer();
        this.handlers.disconnect();
    }

    private connect(): void {
        this.generation++;
        this.startedAt = performance.now();
        this.setStatus({ state: 'connecting' });
        this.schedule(() => this.failed('连接投屏服务超时'), CONNECT_TIMEOUT_MS);
        this.handlers.connect();
    }

    private setStatus(status: StreamStatus): void {
        this.state = status.state;
        this.handlers.status(status);
    }

    private schedule(callback: () => void, delay: number): void {
        this.clearTimer();
        this.timer = setTimeout(callback, delay);
    }

    private clearTimer(): void {
        clearTimeout(this.timer);
        this.timer = undefined;
    }
}
