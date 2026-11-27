import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { IncomingMessage } from 'http';
import express, { Router } from 'express';
import WS from 'ws';
import { sessionPage } from './sessionPage';

const SESSION_LIFETIME = 8 * 60 * 60 * 1000;
const REMEMBER_LIFETIME = 14 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 16;
const MAX_FAILURES = 8;
const LOGIN_COOLDOWN = 60_000;

interface Session {
    origin: string;
    expiresAt: number;
    remembered: boolean;
    sockets: Set<WS>;
    timer: NodeJS.Timeout;
}

export class SessionAuth {
    private static instance?: SessionAuth;
    private readonly sessions = new Map<string, Session>();
    private readonly origin?: string;
    private readonly allowedOrigins = new Set<string>();
    private readonly passwordHash?: Buffer;
    private readonly secure: boolean;
    private readonly cookieName: string;
    private readonly sessionFile = join(homedir(), '.ws-scrcpy', 'sessions.json');
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
            this.allowedOrigins.add(url.origin);
            const extraOrigins = (process.env.WS_SCRCPY_AUTH_EXTRA_ORIGINS || '')
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean);
            for (const extraOrigin of extraOrigins) {
                const extraUrl = new URL(extraOrigin);
                if (
                    extraOrigin !== extraUrl.origin ||
                    extraUrl.protocol !== url.protocol ||
                    extraUrl.protocol !== 'https:'
                ) {
                    throw new Error('Additional login origins must be HTTPS origins');
                }
                this.allowedOrigins.add(extraUrl.origin);
            }
            this.passwordHash = this.hash(password);
            this.restoreSessions();
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

    private sessionId(token: string): string {
        return createHmac('sha256', this.passwordHash!).update(token).digest('hex');
    }

    private requestId(request: IncomingMessage): string {
        const token = this.token(request);
        return token && /^[a-f0-9]{64}$/.test(token) ? this.sessionId(token) : '';
    }

    private getSession(request: IncomingMessage): Session | undefined {
        const session = this.sessions.get(this.requestId(request));
        return session && session.expiresAt > Date.now() && new URL(session.origin).host === request.headers.host
            ? session
            : undefined;
    }

    private allowsOrigin(request: IncomingMessage): boolean {
        const origin = request.headers.origin;
        return !!origin && this.allowedOrigins.has(origin) && new URL(origin).host === request.headers.host;
    }

    private restoreSessions(): void {
        let contents: string;
        try {
            contents = readFileSync(this.sessionFile, 'utf8');
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return;
            }
            throw error;
        }
        const now = Date.now();
        for (const { id, origin, expiresAt } of JSON.parse(contents)) {
            if (
                typeof id === 'string' &&
                /^[a-f0-9]{64}$/.test(id) &&
                this.allowedOrigins.has(origin) &&
                Number.isSafeInteger(expiresAt) &&
                expiresAt > now &&
                expiresAt <= now + REMEMBER_LIFETIME &&
                this.sessions.size < MAX_SESSIONS
            ) {
                this.addSession(id, origin, expiresAt, true);
            }
        }
    }

    private saveSessions(): void {
        const records = Array.from(this.sessions)
            .filter(([, session]) => session.remembered)
            .map(([id, { origin, expiresAt }]) => ({ id, origin, expiresAt }));
        mkdirSync(dirname(this.sessionFile), { recursive: true, mode: 0o700 });
        const temporary = `${this.sessionFile}.tmp`;
        writeFileSync(temporary, JSON.stringify(records), { mode: 0o600 });
        renameSync(temporary, this.sessionFile);
    }

    private revoke(id: string, persist = true): void {
        const session = this.sessions.get(id);
        if (session) {
            this.sessions.delete(id);
            clearTimeout(session.timer);
            session.sockets.forEach((socket) => socket.terminate());
            if (session.remembered && persist) {
                this.saveSessions();
            }
        }
    }

    private addSession(id: string, origin: string, expiresAt: number, remembered: boolean): void {
        const timer = setTimeout(() => this.revoke(id, false), expiresAt - Date.now()).unref();
        this.sessions.set(id, { origin, expiresAt, remembered, sockets: new Set(), timer });
    }

    private createSession(origin: string, lifetime: number, remembered: boolean): string {
        if (this.sessions.size >= MAX_SESSIONS) {
            const oldest = this.sessions.keys().next().value;
            if (oldest) {
                this.revoke(oldest);
            }
        }
        const token = randomBytes(32).toString('hex');
        this.addSession(this.sessionId(token), origin, Date.now() + lifetime, remembered);
        if (remembered) {
            this.saveSessions();
        }
        return token;
    }

    public allowsUpgrade(request: IncomingMessage): boolean {
        return (
            !this.enabled || (this.allowsOrigin(request) && this.getSession(request)?.origin === request.headers.origin)
        );
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
                const session = this.getSession(request);
                if (!this.allowsOrigin(request) || (session && session.origin !== request.headers.origin)) {
                    response.sendStatus(403);
                } else {
                    next();
                }
            },
            express.urlencoded({ extended: false, limit: '2kb', parameterLimit: 2 }),
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
                this.revoke(this.requestId(request));
                const remembered = request.body?.remember === 'yes';
                const lifetime = remembered ? REMEMBER_LIFETIME : SESSION_LIFETIME;
                response.set(
                    'Set-Cookie',
                    this.cookie(this.createSession(request.headers.origin!, lifetime, remembered), lifetime / 1000),
                );
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
            const session = this.getSession(request);
            if (!this.allowsOrigin(request) || (session && session.origin !== request.headers.origin)) {
                response.sendStatus(403);
                return;
            }
            this.revoke(this.requestId(request));
            response.set('Set-Cookie', this.cookie('', 0));
            response.redirect(303, login);
        });
        return router;
    }
}
