import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { readFileSync } from 'fs';
import { IncomingMessage } from 'http';
import express, { Router } from 'express';
import WS from 'ws';
import { sessionPage } from './sessionPage';

const SESSION_LIFETIME = 8 * 60 * 60 * 1000;
const MAX_SESSIONS = 16;
const MAX_FAILURES = 8;
const LOGIN_COOLDOWN = 60_000;

interface Session {
    sockets: Set<WS>;
    timer: NodeJS.Timeout;
}

export class SessionAuth {
    private static instance?: SessionAuth;
    private readonly sessions = new Map<string, Session>();
    private readonly origin?: string;
    private readonly passwordHash?: Buffer;
    private readonly secure: boolean;
    private readonly cookieName: string;
    private failures = 0;
    private cooldownUntil = 0;

    public static getInstance(): SessionAuth {
        return (this.instance ??= new SessionAuth());
    }

    private constructor() {
        const passwordFile = process.env.WS_SCRCPY_PASSWORD_FILE;
        const password = passwordFile ? readFileSync(passwordFile, 'utf8').replace(/\r?\n$/, '') : '';
        const configuredOrigin = process.env.WS_SCRCPY_AUTH_ORIGIN;
        if (passwordFile || configuredOrigin || process.env.WS_SCRCPY_AUTH_REQUIRED === '1') {
            const bytes = Buffer.byteLength(password);
            if (bytes < 16 || bytes > 256 || !configuredOrigin) {
                throw new Error('Login requires WS_SCRCPY_PASSWORD_FILE (16–256 bytes) and WS_SCRCPY_AUTH_ORIGIN');
            }
            const url = new URL(configuredOrigin);
            const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
            if (
                configuredOrigin !== url.origin ||
                (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
            ) {
                throw new Error('WS_SCRCPY_AUTH_ORIGIN must be an HTTPS origin or a loopback HTTP origin');
            }
            this.origin = url.origin;
            this.passwordHash = this.hash(password);
        }
        this.secure = this.origin?.startsWith('https:') ?? false;
        this.cookieName = this.secure ? '__Host-ws_scrcpy_session' : 'ws_scrcpy_session';
    }

    public get enabled(): boolean {
        return !!this.passwordHash;
    }

    private hash(password: string): Buffer {
        return createHash('sha256').update(password).digest();
    }

    private cookie(token: string, maxAge: number): string {
        const secure = this.secure ? '; Secure' : '';
        return `${this.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
    }

    private token(request: IncomingMessage): string | undefined {
        return request.headers.cookie
            ?.split(';')
            .map((part) => part.trim())
            .find((part) => part.startsWith(`${this.cookieName}=`))
            ?.slice(this.cookieName.length + 1);
    }

    private getSession(request: IncomingMessage): Session | undefined {
        return this.sessions.get(this.token(request) ?? '');
    }

    private revoke(token: string): void {
        const session = this.sessions.get(token);
        if (session) {
            this.sessions.delete(token);
            clearTimeout(session.timer);
            session.sockets.forEach((socket) => socket.terminate());
        }
    }

    private createSession(): string {
        if (this.sessions.size >= MAX_SESSIONS) {
            const oldest = this.sessions.keys().next().value;
            if (oldest) {
                this.revoke(oldest);
            }
        }
        const token = randomBytes(32).toString('hex');
        const timer = setTimeout(() => this.revoke(token), SESSION_LIFETIME).unref();
        this.sessions.set(token, { sockets: new Set(), timer });
        return token;
    }

    public allowsUpgrade(request: IncomingMessage): boolean {
        return !this.enabled || (request.headers.origin === this.origin && !!this.getSession(request));
    }

    public trackSocket(request: IncomingMessage, socket: WS): boolean {
        if (!this.enabled) {
            return true;
        }
        const session = this.getSession(request);
        if (!session) {
            socket.terminate();
            return false;
        }
        session.sockets.add(socket);
        socket.once('close', () => session.sockets.delete(socket));
        return true;
    }

    public router(base: string): Router {
        const router = Router();
        router.get('/healthz', (_request, response) => response.sendStatus(204));
        if (!this.passwordHash) {
            return router;
        }
        const passwordHash = this.passwordHash;
        const login = `${base}login`;
        router.use((_request, response, next) => {
            response.set('Cache-Control', 'no-store');
            response.set('X-Content-Type-Options', 'nosniff');
            response.set('X-Frame-Options', 'SAMEORIGIN');
            next();
        });
        router.get('/login', (request, response) => {
            response.set('X-Frame-Options', 'DENY');
            if (this.getSession(request)) {
                response.redirect(303, base);
            } else {
                response.send(sessionPage('login'));
            }
        });
        router.post(
            '/login',
            (request, response, next) => {
                if (request.headers.origin !== this.origin) {
                    response.sendStatus(403);
                } else {
                    next();
                }
            },
            express.urlencoded({ extended: false, limit: '2kb', parameterLimit: 1 }),
            (request, response) => {
                const remaining = this.cooldownUntil - Date.now();
                if (remaining > 0) {
                    response.set('Retry-After', String(Math.ceil(remaining / 1000)));
                    response.status(429).send(sessionPage('login', '尝试次数过多，请稍后再试。'));
                    return;
                }
                const password: unknown = request.body?.password;
                if (typeof password !== 'string' || !timingSafeEqual(this.hash(password), passwordHash)) {
                    if (++this.failures >= MAX_FAILURES) {
                        this.cooldownUntil = Date.now() + LOGIN_COOLDOWN;
                        this.failures = 0;
                    }
                    response.status(401).send(sessionPage('login', '密码不正确，请重试。'));
                    return;
                }
                this.failures = 0;
                this.revoke(this.token(request) ?? '');
                response.set('Set-Cookie', this.cookie(this.createSession(), SESSION_LIFETIME / 1000));
                response.redirect(303, base);
            },
        );
        router.use((request, response, next) => {
            if (this.getSession(request)) {
                next();
            } else if (request.method === 'GET' && request.headers.accept?.includes('text/html')) {
                response.redirect(303, login);
            } else {
                response.sendStatus(401);
            }
        });
        router.get('/session', (_request, response) => response.sendStatus(204));
        router.get('/logout', (_request, response) => response.send(sessionPage('logout')));
        router.post('/logout', (request, response) => {
            if (request.headers.origin !== this.origin) {
                response.sendStatus(403);
                return;
            }
            this.revoke(this.token(request) ?? '');
            response.set('Set-Cookie', this.cookie('', 0));
            response.redirect(303, login);
        });
        return router;
    }
}
