import { KeyCodeControlMessage } from '../controlMessage/KeyCodeControlMessage';
import KeyEvent from './android/KeyEvent';
import { KeyToCodeMap } from './KeyToCodeMap';

export interface KeyEventListener {
    onKeyEvent: (event: KeyCodeControlMessage) => void;
}

export class KeyInputHandler {
    private static readonly pressedKeys = new Map<number, number>();
    private static readonly listeners: Set<KeyEventListener> = new Set();
    private static handler = (event: KeyboardEvent): void => {
        const keyCode = KeyToCodeMap.get(event.code);
        if (!keyCode) {
            return;
        }
        const target = event.composedPath()[0];
        const editing =
            target instanceof HTMLElement &&
            (target.isContentEditable || !!target.closest('input, textarea, select, button, [role="textbox"]'));
        const keyUp = event.type === 'keyup';
        const previous = KeyInputHandler.pressedKeys.get(keyCode);
        if (
            keyUp
                ? previous === undefined
                : editing || event.isComposing || event.defaultPrevented || (event.repeat && previous === undefined)
        ) {
            return;
        }
        const repeatCount = !keyUp && event.repeat ? (previous ?? 0) + 1 : 0;
        if (keyUp) {
            KeyInputHandler.pressedKeys.delete(keyCode);
        } else {
            KeyInputHandler.pressedKeys.set(keyCode, repeatCount);
        }
        const metaState =
            (event.getModifierState('Alt') ? KeyEvent.META_ALT_ON : 0) |
            (event.getModifierState('Shift') ? KeyEvent.META_SHIFT_ON : 0) |
            (event.getModifierState('Control') ? KeyEvent.META_CTRL_ON : 0) |
            (event.getModifierState('Meta') ? KeyEvent.META_META_ON : 0) |
            (event.getModifierState('CapsLock') ? KeyEvent.META_CAPS_LOCK_ON : 0) |
            (event.getModifierState('ScrollLock') ? KeyEvent.META_SCROLL_LOCK_ON : 0) |
            (event.getModifierState('NumLock') ? KeyEvent.META_NUM_LOCK_ON : 0);

        const action = keyUp ? KeyEvent.ACTION_UP : KeyEvent.ACTION_DOWN;
        const controlMessage = new KeyCodeControlMessage(action, keyCode, repeatCount, metaState);
        KeyInputHandler.listeners.forEach((listener) => {
            listener.onKeyEvent(controlMessage);
        });
        if (!editing) {
            event.preventDefault();
        }
    };
    private static releaseKeys = (): void => {
        for (const keyCode of KeyInputHandler.pressedKeys.keys()) {
            const message = new KeyCodeControlMessage(KeyEvent.ACTION_UP, keyCode, 0, 0);
            KeyInputHandler.listeners.forEach((listener) => listener.onKeyEvent(message));
        }
        KeyInputHandler.pressedKeys.clear();
    };

    private static attachListeners(): void {
        document.body.addEventListener('keydown', this.handler);
        document.body.addEventListener('keyup', this.handler);
        window.addEventListener('blur', this.releaseKeys);
    }
    private static detachListeners(): void {
        document.body.removeEventListener('keydown', this.handler);
        document.body.removeEventListener('keyup', this.handler);
        window.removeEventListener('blur', this.releaseKeys);
    }
    public static addEventListener(listener: KeyEventListener): void {
        if (!this.listeners.size) {
            this.attachListeners();
        }
        this.listeners.add(listener);
    }
    public static removeEventListener(listener: KeyEventListener): void {
        if (this.listeners.has(listener) && this.listeners.size === 1) {
            this.releaseKeys();
        }
        this.listeners.delete(listener);
        if (!this.listeners.size) {
            this.detachListeners();
        }
    }
}
