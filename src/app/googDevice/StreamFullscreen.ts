import Size from '../Size';

type LockableOrientation = ScreenOrientation & {
    lock?: (orientation: 'landscape' | 'portrait') => Promise<void>;
};

export class StreamFullscreen {
    private readonly exit = document.createElement('button');
    private readonly hint = document.createElement('p');
    private active = false;
    private locked = false;

    constructor(private readonly view: HTMLElement, private readonly videoSize: () => Size | undefined) {
        this.exit.className = 'immersive-exit';
        this.exit.type = 'button';
        this.exit.textContent = '退出全屏';
        this.exit.onclick = () => void this.leave();
        this.hint.className = 'immersive-hint';
        this.hint.setAttribute('role', 'status');
        this.view.append(this.exit, this.hint);
        document.addEventListener('fullscreenchange', this.onFullscreenChange);
        document.addEventListener('keydown', this.onKeyDown, true);
    }

    public async enter(): Promise<void> {
        if (this.active) {
            return;
        }
        this.setActive(true);
        try {
            if (document.fullscreenEnabled && this.view.requestFullscreen) {
                await this.view.requestFullscreen({ navigationUI: 'hide' });
                const size = this.videoSize();
                const orientation = screen.orientation as LockableOrientation | undefined;
                if (size && orientation?.lock && matchMedia('(pointer: coarse)').matches) {
                    await orientation.lock(size.width > size.height ? 'landscape' : 'portrait');
                    this.locked = document.fullscreenElement === this.view;
                    if (!this.locked) {
                        orientation.unlock();
                    }
                }
            }
        } catch {
            if (!this.active) {
                return;
            }
        }
        if (this.active && document.fullscreenElement !== this.view && matchMedia('(display-mode: browser)').matches) {
            this.hint.textContent = '浏览器未允许全屏。安装到主屏幕后可去掉地址栏。';
        }
    }

    private async leave(): Promise<void> {
        this.setActive(false);
        if (document.fullscreenElement === this.view) {
            await document.exitFullscreen().catch(() => undefined);
        }
    }

    private setActive(active: boolean): void {
        this.active = active;
        this.view.classList.toggle('immersive-stream', active);
        if (!active) {
            this.hint.textContent = '';
            if (this.locked) {
                screen.orientation.unlock();
                this.locked = false;
            }
        }
    }

    private onFullscreenChange = (): void => {
        if (this.active && document.fullscreenElement !== this.view) {
            this.setActive(false);
        }
    };

    private onKeyDown = (event: KeyboardEvent): void => {
        if (this.active && event.key === 'Escape') {
            event.stopPropagation();
            void this.leave();
        }
    };

    public dispose(): void {
        document.removeEventListener('fullscreenchange', this.onFullscreenChange);
        document.removeEventListener('keydown', this.onKeyDown, true);
        void this.leave();
    }
}
