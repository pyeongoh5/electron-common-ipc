import * as assert from 'assert';
import { EventEmitter } from 'events';

import { IpcPacketBuffer } from 'socket-serializer';

import * as IpcBusUtils from '../IpcBusUtils';
import * as Client from '../IpcBusClient';

import { IpcBusTransportImpl } from '../IpcBusTransportImpl';
import { IpcBusCommand } from '../IpcBusCommand';

export const IPCBUS_TRANSPORT_RENDERER_HANDSHAKE = 'ECIPC:IpcBusRenderer:Connect';
export const IPCBUS_TRANSPORT_RENDERER_COMMAND = 'ECIPC:IpcBusRenderer:Command';
export const IPCBUS_TRANSPORT_RENDERER_EVENT = 'ECIPC:IpcBusRenderer:Event';

// export interface HandshakeInfo {
//     process: {
//         wcid: number;
//         rid: number;
//         pid: number;
//     }
// }

export interface IpcWindow extends EventEmitter {
    send(channel: string, ...args: any[]): void;
}

// Implementation for renderer process
/** @internal */
export class IpcBusTransportWindow extends IpcBusTransportImpl {
    private _ipcWindow: IpcWindow;
    private _onIpcEventReceived: (...args: any[]) => void;
    private _connected: boolean;
    private _packetOut: IpcPacketBuffer;

    constructor(contextType: Client.IpcBusProcessType, ipcWindow: IpcWindow) {
        assert(contextType === 'renderer' || contextType === 'renderer-frame', `IpcBusTransportWindow: contextType must not be a ${contextType}`);
        super({ type: contextType, pid: -1 });
        this._ipcWindow = ipcWindow;
        this._packetOut = new IpcPacketBuffer();
    }

    protected _reset() {
        this._promiseConnected = null;
        if (this._connected) {
            this._connected = false;
            if (this._onIpcEventReceived) {
                this._ipcWindow.removeListener(IPCBUS_TRANSPORT_RENDERER_EVENT, this._onIpcEventReceived);
                this._onIpcEventReceived = null;
            }
        }
    }

    protected _onConnect(eventOrPeer: any, peerOrUndefined: Client.IpcBusPeer): boolean {
        // IpcBusUtils.Logger.enable && IpcBusUtils.Logger.info(`[IPCBusTransport:Window] _onConnect`);
        // In sandbox mode, 1st parameter is no more the event, but directly arguments !!!
        if (peerOrUndefined) {
            if ((peerOrUndefined as Client.IpcBusPeer).id === this._ipcBusPeer.id) {
                this._ipcBusPeer = peerOrUndefined;
                IpcBusUtils.Logger.enable && IpcBusUtils.Logger.info(`[IPCBusTransport:Window] Activate Standard listening for #${this._ipcBusPeer.name}`);
                this._onIpcEventReceived = this._onCommandBufferReceived.bind(this);
                this._ipcWindow.addListener(IPCBUS_TRANSPORT_RENDERER_EVENT, this._onIpcEventReceived);
                return true;
            }
        }
        else {
            if ((eventOrPeer as Client.IpcBusPeer).id === this._ipcBusPeer.id) {
                this._ipcBusPeer = eventOrPeer;
                IpcBusUtils.Logger.enable && IpcBusUtils.Logger.info(`[IPCBusTransport:Window] Activate Sandbox listening for #${this._ipcBusPeer.name}`);
                this._onIpcEventReceived = this._onCommandBufferReceived.bind(this, undefined);
                this._ipcWindow.addListener(IPCBUS_TRANSPORT_RENDERER_EVENT, this._onIpcEventReceived);
                return true;
            }
        }
        return false;
    };

    /// IpcBusTrandport API
    ipcHandshake(options: Client.IpcBusClient.ConnectOptions): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            // this._ipcRendererReady.then(() => {
            options = IpcBusUtils.CheckConnectOptions(options);
            // Do not type timer as it may differ between node and browser api, let compiler and browserify deal with.
            let timer: NodeJS.Timer;
            const onIpcConnect = (eventOrPeer: any, peerOrUndefined: Client.IpcBusPeer) => {
                if (this._connected) {
                    if (this._onConnect(eventOrPeer, peerOrUndefined)) {
                        this._ipcWindow.removeListener(IPCBUS_TRANSPORT_RENDERER_HANDSHAKE, onIpcConnect);
                        clearTimeout(timer);
                        resolve();
                    }
                }
                else {
                    this._ipcWindow.removeListener(IPCBUS_TRANSPORT_RENDERER_HANDSHAKE, onIpcConnect);
                    reject('cancelled');
                }
            };

            // Below zero = infinite
            if (options.timeoutDelay >= 0) {
                timer = setTimeout(() => {
                    timer = null;
                    this._ipcWindow.removeListener(IPCBUS_TRANSPORT_RENDERER_HANDSHAKE, onIpcConnect);
                    this._reset();
                    reject('timeout');
                }, options.timeoutDelay);
            }
            // We wait for the bridge confirmation
            this._connected = true;
            this._ipcWindow.addListener(IPCBUS_TRANSPORT_RENDERER_HANDSHAKE, onIpcConnect);
            this.ipcSend(IpcBusCommand.Kind.Handshake, '');
        });
    }

    ipcClose(options?: Client.IpcBusClient.CloseOptions): Promise<void> {
        if (this._connected) {
            this.ipcSend(IpcBusCommand.Kind.Close, '');
            this._reset();
        }
        return Promise.resolve();
    }

    // We serialize in renderer process to save master CPU.
    // We keep ipcBusCommand in plain text, once again to have master handling it easily
    ipcPostCommand(ipcBusCommand: IpcBusCommand, args?: any[]): void {
        if (this._connected) {
            ipcBusCommand.bridge = true;
            if (args) {
                this._packetOut.serializeArray([ipcBusCommand, args]);
            }
            else {
                this._packetOut.serializeArray([ipcBusCommand]);
            }
            this._ipcWindow.send(IPCBUS_TRANSPORT_RENDERER_COMMAND, ipcBusCommand, this._packetOut.buffer);
        }
    }
}
