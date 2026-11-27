import { ToolBox } from '../../toolbox/ToolBox';
import KeyEvent from '../android/KeyEvent';
import SvgImage from '../../ui/SvgImage';
import { KeyCodeControlMessage } from '../../controlMessage/KeyCodeControlMessage';
import { ToolBoxButton } from '../../toolbox/ToolBoxButton';
import { ToolBoxElement } from '../../toolbox/ToolBoxElement';
import { ToolBoxCheckbox } from '../../toolbox/ToolBoxCheckbox';
import { StreamClientScrcpy } from '../client/StreamClientScrcpy';
import { BasePlayer } from '../../player/BasePlayer';
import { GoogMoreBox } from './GoogMoreBox';

const BUTTONS = [
    {
        title: '电源',
        code: KeyEvent.KEYCODE_POWER,
        icon: SvgImage.Icon.POWER,
    },
    {
        title: '增大音量',
        code: KeyEvent.KEYCODE_VOLUME_UP,
        icon: SvgImage.Icon.VOLUME_UP,
    },
    {
        title: '减小音量',
        code: KeyEvent.KEYCODE_VOLUME_DOWN,
        icon: SvgImage.Icon.VOLUME_DOWN,
    },
    {
        title: '返回',
        code: KeyEvent.KEYCODE_BACK,
        icon: SvgImage.Icon.BACK,
    },
    {
        title: '主页',
        code: KeyEvent.KEYCODE_HOME,
        icon: SvgImage.Icon.HOME,
    },
    {
        title: '最近任务',
        code: KeyEvent.KEYCODE_APP_SWITCH,
        icon: SvgImage.Icon.OVERVIEW,
    },
];

export interface GoogToolBoxOptions {
    // Start with keyboard capture enabled instead of requiring the user to tick
    // the "Capture keyboard" checkbox first.
    captureKeyboard?: boolean;
    onBack?: () => void;
}

export class GoogToolBox extends ToolBox {
    protected constructor(list: ToolBoxElement<any>[]) {
        super(list);
    }

    public static createToolBox(
        udid: string,
        player: BasePlayer,
        client: StreamClientScrcpy,
        settingsMenu?: GoogMoreBox,
        options: GoogToolBoxOptions = {},
    ): GoogToolBox {
        const playerName = player.getName();
        const list = BUTTONS.slice();
        const sendKey = (code: number, action: number) => {
            client.sendMessage(new KeyCodeControlMessage(action, code, 0, 0));
        };
        const pressed = new Set<number>();
        const releaseKey = (code: number) => {
            if (!pressed.delete(code)) {
                return;
            }
            sendKey(code, KeyEvent.ACTION_UP);
        };
        const handler = <K extends keyof HTMLElementEventMap, T extends HTMLElement>(
            type: K,
            element: ToolBoxElement<T>,
        ) => {
            if (!element.optional?.code) {
                return;
            }
            const { code } = element.optional;
            if (type === 'pointerdown') {
                if (!pressed.has(code)) {
                    pressed.add(code);
                    sendKey(code, KeyEvent.ACTION_DOWN);
                }
            } else {
                releaseKey(code);
            }
        };
        const elements: ToolBoxElement<any>[] = list.map((item) => {
            const button = new ToolBoxButton(item.title, item.icon, {
                code: item.code,
            });
            button.addEventListener('pointerdown', handler);
            button.addEventListener('pointerup', handler);
            button.addEventListener('pointercancel', handler);
            button.addEventListener('pointerleave', handler);
            if (
                [KeyEvent.KEYCODE_POWER, KeyEvent.KEYCODE_VOLUME_UP, KeyEvent.KEYCODE_VOLUME_DOWN].includes(item.code)
            ) {
                button.getElement().classList.add('touch-secondary');
            }
            return button;
        });
        if (player.supportsScreenshot) {
            const screenshot = new ToolBoxButton('截图', SvgImage.Icon.CAMERA);
            screenshot.addEventListener('click', () => {
                player.createScreenshot(client.getDeviceName());
            });
            screenshot.getElement().classList.add('touch-secondary');
            elements.push(screenshot);
        }

        const fullscreen = new ToolBoxButton('全屏', SvgImage.Icon.FULL_SCREEN);
        fullscreen.addEventListener('click', () => client.enterFullscreen());
        elements.unshift(fullscreen);

        const keyboard = new ToolBoxCheckbox(
            '捕获键盘',
            SvgImage.Icon.KEYBOARD,
            `capture_keyboard_${udid}_${playerName}`,
        );
        keyboard.addEventListener('click', (_, el) => {
            const element = el.getElement();
            client.setHandleKeyboardEvents(element.checked);
            if (element.checked) {
                element.closest<HTMLElement>('.device-view')?.focus();
            }
        });
        if (options.captureKeyboard) {
            keyboard.getElement().checked = true;
            client.setHandleKeyboardEvents(true);
        }
        elements.push(keyboard);

        if (settingsMenu) {
            const moreBox = settingsMenu.getHolderElement();
            const extras = document.createElement('details');
            extras.className = 'touch-controls';
            const summary = document.createElement('summary');
            summary.textContent = '更多按键';
            extras.append(summary);
            list.slice(0, 3).forEach(({ title, code }) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = title;
                button.onclick = () => {
                    sendKey(code, KeyEvent.ACTION_DOWN);
                    sendKey(code, KeyEvent.ACTION_UP);
                };
                extras.append(button);
            });
            if (player.supportsScreenshot) {
                const screenshot = document.createElement('button');
                screenshot.type = 'button';
                screenshot.textContent = '截图';
                screenshot.onclick = () => player.createScreenshot(client.getDeviceName());
                extras.append(screenshot);
            }
            moreBox.append(extras);
            const displayId = player.getVideoSettings().displayId;
            const id = `show_more_${udid}_${playerName}_${displayId}`;
            const more = new ToolBoxCheckbox('投屏设置与工具', SvgImage.Icon.SETTINGS, id);
            more.addEventListener('click', (_, el) => {
                const element = el.getElement();
                settingsMenu.setOpen(element.checked);
            });
            settingsMenu.setOnOpenChange((open) => {
                more.getElement().checked = open;
            });
            elements.unshift(more);
        }
        if (options.onBack) {
            const back = new ToolBoxButton('返回设备列表', SvgImage.Icon.ARROW_BACK);
            back.addEventListener('click', () => options.onBack?.());
            elements.unshift(back);
        }
        const toolBox = new GoogToolBox(elements);
        const holder = toolBox.getHolderElement();
        const keyboardInput = keyboard.getElement();
        if (keyboardInput.parentElement === holder) {
            const divider = document.createElement('div');
            divider.className = 'control-divider';
            divider.setAttribute('aria-hidden', 'true');
            holder.insertBefore(divider, keyboardInput);
        }
        return toolBox;
    }
}
