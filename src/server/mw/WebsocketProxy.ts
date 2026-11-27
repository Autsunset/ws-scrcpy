import { Mw, RequestParameters } from './Mw';
import WS from 'ws';
import { ACTION } from '../../common/Action';
import { Multiplexer } from '../../packages/multiplexer/Multiplexer';

export class WebsocketProxy extends Mw {
    public static readonly TAG = 'WebsocketProxy';
    private remoteSocket?: WS;
    private released = false;
    private readonly storage: WS.MessageEvent[] = [];
    private pendingBytes = 0;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public static processRequest(ws: WS, params: RequestParameters): WebsocketProxy | undefined {
        const { action, url } = params;
        if (action !== ACTION.PROXY_WS) {
            return;
        }
        const wsString = url.searchParams.get('ws');
        if (!wsString) {
            ws.close(4003, `[${this.TAG}] Invalid value "${ws}" for "ws" parameter`);
            return;
        }
        return this.createProxy(ws, wsString);
    }

    public static createProxy(ws: WS | Multiplexer, remoteUrl: string): WebsocketProxy {
        const service = new WebsocketProxy(ws);
        service.init(remoteUrl).catch((e) => {
            const msg = `[${this.TAG}] Failed to start service: ${e.message}`;
            console.error(msg);
            ws.close(4005, msg);
        });
        return service;
    }

    constructor(ws: WS | Multiplexer) {
        super(ws);
    }

    public async init(remoteUrl: string): Promise<void> {
        if (this.released) {
            return;
        }
        this.name = `[${WebsocketProxy.TAG}{$${remoteUrl}}]`;
        const remoteSocket = (this.remoteSocket = new WS(remoteUrl, { handshakeTimeout: 10000 }));
        remoteSocket.onopen = () => {
            for (const event of this.storage) {
                remoteSocket.send(event.data);
            }
            this.storage.length = this.pendingBytes = 0;
        };
        remoteSocket.onmessage = (event) => {
            if (this.ws && this.ws.readyState === this.ws.OPEN) {
                if (Array.isArray(event.data)) {
                    event.data.forEach((data) => this.ws.send(data));
                } else {
                    this.ws.send(event.data);
                }
            }
        };
        remoteSocket.onclose = (e) => {
            if (this.ws.readyState === this.ws.OPEN) {
                this.ws.close(e.wasClean ? 1000 : 4010);
            }
        };
        remoteSocket.onerror = (e) => {
            if (this.ws.readyState === this.ws.OPEN) {
                console.error(`${this.name} upstream connection error:`, e.message);
                this.ws.close(4011, 'Upstream connection failed');
            }
        };
    }

    protected onSocketMessage(event: WS.MessageEvent): void {
        if (this.released) {
            return;
        }
        if (this.remoteSocket?.readyState === WS.OPEN) {
            this.remoteSocket.send(event.data);
        } else if (!this.remoteSocket || this.remoteSocket.readyState === WS.CONNECTING) {
            const { data } = event;
            this.pendingBytes += Array.isArray(data)
                ? data.reduce((total, buffer) => total + buffer.byteLength, 0)
                : typeof data === 'string'
                ? Buffer.byteLength(data)
                : data.byteLength;
            if (this.storage.length >= 256 || this.pendingBytes > 1024 * 1024) {
                this.ws.close(1013, 'Upstream connection not ready');
                this.release();
                return;
            }
            this.storage.push(event);
        }
    }

    public release(): void {
        if (this.released) {
            return;
        }
        this.released = true;
        this.storage.length = this.pendingBytes = 0;
        super.release();
        this.remoteSocket?.close();
    }
}
