export function sessionPage(mode: 'login' | 'logout', error?: string): string {
    const signingIn = mode === 'login';
    const title = signingIn ? '登录云手机' : '退出登录';
    return `<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="referrer" content="same-origin">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; manifest-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'">
    <meta name="theme-color" content="#0b111e">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <link rel="manifest" href="./app.webmanifest">
    <link rel="apple-touch-icon" href="./pwa/apple-touch-icon.png">
    <title>${title} · ws-scrcpy</title>
    <style>
        :root {
            color-scheme: light dark;
            font: 100%/1.5 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif;
            --bg: #f4f6f9;
            --surface: #ffffff;
            --ink: #0f172a;
            --muted: #64748b;
            --field: #f8fafc;
            --line: #e2e8f0;
            --line-strong: #cbd5e1;
            --accent: #2563eb;
            --accent-hover: #1d4ed8;
            --accent-soft: rgba(37, 99, 235, 0.14);
            --on-accent: #ffffff;
            --error: #e11d48;
            --error-bg: rgba(225, 29, 72, 0.08);
            --shadow: 0 20px 50px rgba(15, 23, 42, 0.08);
            background: var(--bg);
            color: var(--ink);
        }
        @media (prefers-color-scheme: dark) {
            :root {
                --bg: #0b111e;
                --surface: #131c2e;
                --ink: #f1f5f9;
                --muted: #94a3b8;
                --field: #0f172a;
                --line: rgba(148, 163, 184, 0.16);
                --line-strong: rgba(148, 163, 184, 0.28);
                --accent: #3b82f6;
                --accent-hover: #2563eb;
                --accent-soft: rgba(59, 130, 246, 0.22);
                --on-accent: #ffffff;
                --error: #fda4af;
                --error-bg: rgba(251, 113, 133, 0.12);
                --shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
            }
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            min-height: 100vh;
            min-height: 100svh;
            display: grid;
            grid-template-rows: auto 1fr auto;
            padding-inline: max(clamp(1rem, 4vw, 3rem), env(safe-area-inset-left), env(safe-area-inset-right));
        }
        header {
            min-height: 4.25rem;
            display: flex;
            align-items: center;
            gap: .65rem;
            padding-top: env(safe-area-inset-top);
            border-bottom: 1px solid var(--line);
            font-size: .95rem;
            font-weight: 700;
            letter-spacing: -.015em;
        }
        header svg { width: 1.3rem; height: 1.4rem; color: var(--accent); }
        main {
            width: min(100%, 25rem);
            place-self: center;
            padding: 2rem 1.75rem;
            margin-block: 2rem;
            border: 1px solid var(--line);
            border-radius: 1.15rem;
            background: var(--surface);
            box-shadow: var(--shadow);
        }
        h1 {
            font-size: clamp(1.55rem, 4vw, 1.9rem);
            font-weight: 750;
            line-height: 1.2;
            letter-spacing: -.03em;
            margin: 0 0 .5rem;
        }
        p { color: var(--muted); font-size: .92rem; margin: 0 0 1.5rem; }
        form { display: grid; gap: .6rem; }
        label { font-size: .875rem; font-weight: 600; }
        input, button {
            width: 100%;
            min-height: 2.85rem;
            padding: .65rem .9rem;
            font: inherit;
            border-radius: .6rem;
        }
        input {
            border: 1px solid var(--line-strong);
            background: var(--field);
            color: var(--ink);
            transition: border-color .15s ease, box-shadow .15s ease;
        }
        input:focus {
            outline: none;
            border-color: var(--accent);
            box-shadow: 0 0 0 3px var(--accent-soft);
        }
        button {
            margin-top: .5rem;
            border: 1px solid transparent;
            color: var(--on-accent);
            background: var(--accent);
            font-weight: 600;
            cursor: pointer;
            box-shadow: 0 4px 14px rgba(37, 99, 235, 0.28);
            transition: background-color .15s ease, transform .1s ease;
        }
        button:hover { background: var(--accent-hover); }
        button:active { transform: scale(0.99); }
        :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .error {
            color: var(--error);
            background: var(--error-bg);
            padding: .55rem .75rem;
            border-radius: .5rem;
            margin: .2rem 0;
            font-size: .875rem;
        }
        a {
            color: var(--muted);
            padding: .55rem;
            text-align: center;
            text-decoration: none;
            font-size: .9rem;
            border-radius: .5rem;
        }
        a:hover { color: var(--ink); background: var(--field); }
        footer {
            padding: .9rem 0 max(.9rem, env(safe-area-inset-bottom));
            border-top: 1px solid var(--line);
            color: var(--muted);
            font-size: .8rem;
            text-align: center;
        }
    </style>
</head>
<body>
    <header>
        <svg viewBox="0 0 20 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
            <rect x="3.5" y="1.5" width="13" height="21" rx="3"/>
            <path d="M8 18.5h4M8 5.5h4"/>
        </svg>
        <span>云手机 · ws-scrcpy</span>
    </header>
    <main>
        <h1>${title}</h1>
        <p>${signingIn ? '输入访问密码，继续连接你的设备。' : '退出后，当前会话的投屏与控制连接会断开。'}</p>
        <form method="post" action="./${mode}">
            ${
                signingIn
                    ? '<label for="password">访问密码</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="256" required>'
                    : ''
            }
            ${error ? `<p class="error" role="alert">${error}</p>` : ''}
            <button type="submit">${signingIn ? '登录' : '确认退出'}</button>
            ${signingIn ? '' : '<a href="./">取消</a>'}
        </form>
    </main>
    <footer>私人 Android 控制台</footer>
</body>
</html>`;
}
