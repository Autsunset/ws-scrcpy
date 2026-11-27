import { createHash } from 'crypto';

const resumeSession = `window.addEventListener('pageshow', () => {
    fetch('./session', { credentials: 'same-origin', cache: 'no-store', redirect: 'error' })
        .then(response => {
            if (response.status === 204) location.replace('./' + location.hash);
        })
        .catch(() => {});
});`;
const resumeHash = createHash('sha256').update(resumeSession).digest('base64');

export function sessionPage(mode: 'login' | 'logout', error?: string): string {
    const signingIn = mode === 'login';
    const checkSession = signingIn && !error;
    const resumePolicy = checkSession ? `; connect-src 'self'; script-src 'sha256-${resumeHash}'` : '';
    const title = signingIn ? '登录云手机' : '退出登录';
    return `<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="referrer" content="same-origin">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; manifest-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'${resumePolicy}">
    ${checkSession ? `<script>${resumeSession}</script>` : ''}
    <meta name="color-scheme" content="light dark">
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#fafafa">
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000000">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <link rel="manifest" href="./app.webmanifest" crossorigin="use-credentials">
    <link rel="apple-touch-icon" href="./pwa/apple-touch-icon.png?v=nimbus">
    <title>${title} · ws-scrcpy</title>
    <style>
        :root {
            color-scheme: light dark;
            font: 100%/1.5 'Geist', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif;
            --bg: #fafafa;
            --surface: #ffffff;
            --ink: #171717;
            --muted: #666666;
            --field: #ffffff;
            --line: #ebebeb;
            --line-strong: #d4d4d4;
            --accent: #171717;
            --accent-hover: #333333;
            --accent-soft: rgba(23, 23, 23, 0.1);
            --on-accent: #ffffff;
            --error: #ee0000;
            --error-bg: rgba(238, 0, 0, 0.06);
            --shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
            background: var(--bg);
            color: var(--ink);
        }
        @media (prefers-color-scheme: dark) {
            :root {
                --bg: #000000;
                --surface: #0a0a0a;
                --ink: #ededed;
                --muted: #888888;
                --field: #000000;
                --line: #262626;
                --line-strong: #3d3d3d;
                --accent: #ededed;
                --accent-hover: #ffffff;
                --accent-soft: rgba(255, 255, 255, 0.14);
                --on-accent: #0a0a0a;
                --error: #ff6b6b;
                --error-bg: rgba(255, 77, 77, 0.12);
                --shadow: 0 12px 32px rgba(0, 0, 0, 0.65);
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
            background: var(--bg);
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
            border: 1px solid var(--line-strong);
            border-radius: 4px;
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
        input[type="password"], button {
            width: 100%;
            min-height: 2.85rem;
            padding: .65rem .9rem;
            font: inherit;
            border-radius: 3px;
        }
        input[type="password"] {
            border: 1px solid var(--line-strong);
            background: var(--field);
            color: var(--ink);
            transition: border-color .15s ease, box-shadow .15s ease;
        }
        input[type="password"]:focus {
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
            box-shadow: none;
            transition: background-color .15s ease, transform .1s ease;
        }
        button:hover { background: var(--accent-hover); }
        .remember { display: flex; align-items: center; gap: .5rem; min-height: 2.5rem; cursor: pointer; }
        .remember input { width: 1.1rem; height: 1.1rem; margin: 0; accent-color: var(--accent); }
        button:active { transform: scale(0.99); }
        :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .error {
            color: var(--error);
            background: var(--error-bg);
            padding: .55rem .75rem;
            border-radius: 3px;
            margin: .2rem 0;
            font-size: .875rem;
        }
        a {
            color: var(--muted);
            padding: .55rem;
            text-align: center;
            text-decoration: none;
            font-size: .9rem;
            border-radius: 3px;
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
                    ? `<label for="password">访问密码</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="256" required>
                       <label class="remember"><input name="remember" type="checkbox" value="yes">在此设备保持登录 14 天</label>`
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
