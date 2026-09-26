export interface AudioPacket {
    type: 'audio_write';
    pid: number;
    stream: number;
    frames: number;
    rate?: number;
    channels?: number;
    pcm?: ArrayBuffer;
    sentAt: number;
}
export interface AudioHost {
    resume(): void;
    write(message: AudioPacket): void;
    readonly stats: Record<string, number | string | boolean>;
    close(): Promise<void>;
}
export declare function createAudioWrite(memory: WebAssembly.Memory, post: (message: AudioPacket, transfer?: ArrayBuffer[]) => void, now?: () => number): (pid: number, stream: number, pointer: number, frames: number, rate: number, channels: number) => number;
export declare function createAudioHost(options?: { Context?: typeof AudioContext; now?: () => number }): AudioHost;
