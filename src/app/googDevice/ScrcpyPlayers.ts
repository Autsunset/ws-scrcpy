import type { PlayerClass } from '../player/BasePlayer';

interface PlayerOption {
    playerCodeName: string;
    playerFullName: string;
    isSupported: () => boolean;
    load: () => Promise<PlayerClass>;
}

const options: PlayerOption[] = [];

/// #if USE_H264_CONVERTER
options.push({
    playerCodeName: 'mse',
    playerFullName: 'H264 Converter',
    isSupported: () =>
        typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"'),
    load: async () => (await import('../player/MsePlayer')).MsePlayer,
});
/// #endif

/// #if USE_WEBCODECS
options.push({
    playerCodeName: 'webcodecs',
    playerFullName: 'WebCodecs',
    isSupported: () => typeof VideoDecoder === 'function' && typeof VideoDecoder.isConfigSupported === 'function',
    load: async () => (await import('../player/WebCodecsPlayer')).WebCodecsPlayer,
});
/// #endif

/// #if USE_TINY_H264 || USE_BROADWAY
const hasWebAssembly = () => typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
/// #endif

/// #if USE_TINY_H264
options.push({
    playerCodeName: 'tinyh264',
    playerFullName: 'Tiny H264',
    isSupported: hasWebAssembly,
    load: async () => (await import('../player/TinyH264Player')).TinyH264Player,
});
/// #endif

/// #if USE_BROADWAY
options.push({
    playerCodeName: 'broadway',
    playerFullName: 'Broadway.js',
    isSupported: hasWebAssembly,
    load: async () => (await import('../player/BroadwayPlayer')).BroadwayPlayer,
});
/// #endif

export function getScrcpyPlayerOptions(): PlayerOption[] {
    return options.filter((option) => option.isSupported());
}
