import { type VirtioDevice } from "./core.ts";
/** Linux input event types / codes used by the guest virtio-input driver. */
export declare const Ev: {
    readonly SYN: 0;
    readonly KEY: 1;
    readonly REL: 2;
    readonly ABS: 3;
    readonly REP: 20;
};
export declare const Syn: {
    readonly REPORT: 0;
};
export declare const Rel: {
    readonly X: 0;
    readonly Y: 1;
    readonly WHEEL: 8;
};
export declare const Abs: {
    readonly X: 0;
    readonly Y: 1;
};
/** Common Linux KEY_* / BTN_* codes (include/uapi/linux/input-event-codes.h). */
export declare const Key: {
    readonly RESERVED: 0;
    readonly ESC: 1;
    readonly "1": 2;
    readonly "2": 3;
    readonly "3": 4;
    readonly "4": 5;
    readonly "5": 6;
    readonly "6": 7;
    readonly "7": 8;
    readonly "8": 9;
    readonly "9": 10;
    readonly "0": 11;
    readonly MINUS: 12;
    readonly EQUAL: 13;
    readonly BACKSPACE: 14;
    readonly TAB: 15;
    readonly Q: 16;
    readonly W: 17;
    readonly E: 18;
    readonly R: 19;
    readonly T: 20;
    readonly Y: 21;
    readonly U: 22;
    readonly I: 23;
    readonly O: 24;
    readonly P: 25;
    readonly LEFTBRACE: 26;
    readonly RIGHTBRACE: 27;
    readonly ENTER: 28;
    readonly LEFTCTRL: 29;
    readonly A: 30;
    readonly S: 31;
    readonly D: 32;
    readonly F: 33;
    readonly G: 34;
    readonly H: 35;
    readonly J: 36;
    readonly K: 37;
    readonly L: 38;
    readonly SEMICOLON: 39;
    readonly APOSTROPHE: 40;
    readonly GRAVE: 41;
    readonly LEFTSHIFT: 42;
    readonly BACKSLASH: 43;
    readonly Z: 44;
    readonly X: 45;
    readonly C: 46;
    readonly V: 47;
    readonly B: 48;
    readonly N: 49;
    readonly M: 50;
    readonly COMMA: 51;
    readonly DOT: 52;
    readonly SLASH: 53;
    readonly RIGHTSHIFT: 54;
    readonly LEFTALT: 56;
    readonly SPACE: 57;
    readonly CAPSLOCK: 58;
    readonly F1: 59;
    readonly F2: 60;
    readonly F3: 61;
    readonly F4: 62;
    readonly F5: 63;
    readonly F6: 64;
    readonly F7: 65;
    readonly F8: 66;
    readonly F9: 67;
    readonly F10: 68;
    readonly F11: 87;
    readonly F12: 88;
    readonly RIGHTCTRL: 97;
    readonly RIGHTALT: 100;
    readonly KPENTER: 96;
    readonly KPSLASH: 98;
    readonly SYSRQ: 99;
    readonly NUMLOCK: 69;
    readonly SCROLLLOCK: 70;
    readonly KPASTERISK: 55;
    readonly KPMINUS: 74;
    readonly KPPLUS: 78;
    readonly KP0: 82;
    readonly KP1: 79;
    readonly KP2: 80;
    readonly KP3: 81;
    readonly KP4: 75;
    readonly KP5: 76;
    readonly KP6: 77;
    readonly KP7: 71;
    readonly KP8: 72;
    readonly KP9: 73;
    readonly KPDOT: 83;
    readonly LEFTMETA: 125;
    readonly RIGHTMETA: 126;
    readonly MENU: 139;
    readonly PAUSE: 119;
    readonly HOME: 102;
    readonly UP: 103;
    readonly PAGEUP: 104;
    readonly LEFT: 105;
    readonly RIGHT: 106;
    readonly END: 107;
    readonly DOWN: 108;
    readonly PAGEDOWN: 109;
    readonly INSERT: 110;
    readonly DELETE: 111;
    /** Mouse buttons (BTN_*). */
    readonly BTN_LEFT: 272;
    readonly BTN_RIGHT: 273;
    readonly BTN_MIDDLE: 274;
};
/**
 * A virtio-input keyboard/mouse. Host code calls `send` with Linux evdev
 * triples; the guest sees `/dev/input/event*`.
 */
export interface InputDevice extends VirtioDevice {
    /** Queue a single input event (type/code/value). */
    send(type: number, code: number, value: number): void;
    /** Convenience: key/button press/release + SYN_REPORT. */
    key(code: number, down: boolean, repeat?: boolean): void;
    /** Convenience: relative mouse motion + SYN_REPORT. */
    move(dx: number, dy: number): void;
    /** Convenience: absolute pointer position + SYN_REPORT. */
    abs(x: number, y: number): void;
    /** Convenience: mouse button press/release + SYN_REPORT. */
    button(code: number, down: boolean): void;
    /** Convenience: vertical wheel ticks + SYN_REPORT. */
    wheel(delta: number): void;
}
export declare function inputDevice(options?: {
    name?: string;
    serial?: string;
    /** Guest timer repeats by default; host mode accepts explicit key repeat events. */
    repeatOwner?: "guest" | "host";
    /** Absolute X axis max (inclusive). Default 1023. */
    absXMax?: number;
    /** Absolute Y axis max (inclusive). Default 767. */
    absYMax?: number;
}): InputDevice;
