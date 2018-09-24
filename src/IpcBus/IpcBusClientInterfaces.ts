import { EventEmitter } from 'events';

// Special channels
export const IPCBUS_CHANNEL: string = '/electron-ipc-bus';
export const IPCBUS_CHANNEL_QUERY_STATE: string = `${IPCBUS_CHANNEL}/queryState`;

// Log en vars
export const ELECTRON_IPC_BROKER_LOGPATH_ENV_VAR = 'ELECTRON_IPC_BROKER_LOGPATH';
export const ELECTRON_IPC_BRIDGE_LOGPATH_ENV_VAR = 'ELECTRON_IPC_BRIDGE_LOGPATH';

export type IpcBusProcessType = 'browser' | 'renderer' | 'node' | 'native' | string;

export interface IpcBusProcess {
    type: IpcBusProcessType;
    pid: number;    // Process Id
    rid?: number;   // Renderer Id
    wcid?: number;  // WebContent Id
}

export interface IpcBusPeer {
    id: string;
    name: string;
    process: IpcBusProcess;
}

export interface IpcBusRequest {
    resolve(payload: Object | string): void;
    reject(err: string): void;
}

export interface IpcBusRequestResponse {
    event: IpcBusEvent;
    payload?: Object | string;
    err?: string;
}

export interface IpcBusEvent {
    channel: string;
    sender: IpcBusPeer;
    request?: IpcBusRequest;
}

export interface IpcBusListener {
    (event: IpcBusEvent, ...args: any[]): void;
}

export interface IpcTimeoutOptions {
    timeoutDelay?: number;
}

export interface IpcSocketBufferingOptions {
    socketBuffer?: number;
}

export interface IpcNetOptions {
    port?: number;
    host?: string;
    path?: string;
}

export namespace IpcBusClient {
    export interface ConnectOptions extends IpcTimeoutOptions, IpcSocketBufferingOptions {
        peerName?: string;
    }
    export interface CloseOptions extends IpcTimeoutOptions {
    }

    export interface CreateOptions extends IpcNetOptions {
    }

    export interface CreateFunction {
        (options: CreateOptions): IpcBusClient | null ;
        (port: number, hostname?: string): IpcBusClient | null ;
        (path: string): IpcBusClient | null ;
    }
}

export interface IpcBusClient extends EventEmitter {
    peer: IpcBusPeer;

    connect(options?: IpcBusClient.ConnectOptions): Promise<void>;
    close(options?: IpcBusClient.CloseOptions): Promise<void>;

    send(channel: string, ...args: any[]): void;
    request(channel: string, timeoutDelay: number, ...args: any[]): Promise<IpcBusRequestResponse>;

    // EventEmitter API
    emit(event: string, ...args: any[]): boolean;

    addListener(channel: string, listener: IpcBusListener): this;
    removeListener(channel: string, listener: IpcBusListener): this;
    removeAllListeners(channel?: string): this;
    on(channel: string, listener: IpcBusListener): this;
    once(channel: string, listener: IpcBusListener): this;
    off(channel: string, listener: IpcBusListener): this;

    // EventEmitter API - Added in Node 6...
    prependListener(channel: string, listener: IpcBusListener): this;
    prependOnceListener(channel: string, listener: IpcBusListener): this;
}
