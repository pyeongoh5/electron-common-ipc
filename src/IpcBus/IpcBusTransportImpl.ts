import * as uuid from 'uuid';
import { IpcPacketBuffer } from 'socket-serializer';

import * as Client from './IpcBusClient';
import * as IpcBusUtils from './IpcBusUtils';
import { IpcBusCommand } from './IpcBusCommand';
import { IpcBusTransport } from './IpcBusTransport';

const replyChannelPrefix = `${Client.IPCBUS_CHANNEL}/request-`;
// const v1IdPattern = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';

// export function extractPeerIdFromReplyChannel(replyChannel: string): string {
//     return replyChannel.substr(replyChannelPrefix.length, v1IdPattern.length);
// }

/** @internal */
class DeferredRequest {
    public promise: Promise<Client.IpcBusRequestResponse>;

    public resolve: (value: Client.IpcBusRequestResponse) => void;
    public reject: (err: Client.IpcBusRequestResponse) => void;

    constructor() {
        this.promise = new Promise<Client.IpcBusRequestResponse>((resolve, reject) => {
            this.reject = reject;
            this.resolve = resolve;
        });
    }

    fulFilled(ipcBusCommand: IpcBusCommand, args: any[]) {
        const ipcBusEvent: Client.IpcBusEvent = { channel: ipcBusCommand.request.channel, sender: ipcBusCommand.peer };
        IpcBusUtils.Logger.enable && IpcBusUtils.Logger.info(`[IPCBusTransport] Peer #${ipcBusEvent.sender.name} replied to request on ${ipcBusCommand.request.replyChannel}`);
        if (ipcBusCommand.request.resolve) {
            IpcBusUtils.Logger.enable && IpcBusUtils.Logger.info(`[IPCBusTransport] resolve`);
            const response: Client.IpcBusRequestResponse = { event: ipcBusEvent, payload: args[0] };
            this.resolve(response);
        }
        else if (ipcBusCommand.request.reject) {
            IpcBusUtils.Logger.enable && IpcBusUtils.Logger.info(`[IPCBusTransport] reject`);
            const response: Client.IpcBusRequestResponse = { event: ipcBusEvent, err: args[0] };
            this.reject(response);
        }
        else {
            IpcBusUtils.Logger.enable && IpcBusUtils.Logger.info(`[IPCBusTransport] reject: unknown format`);
            const response: Client.IpcBusRequestResponse = { event: ipcBusEvent, err: 'unknown format' };
            this.reject(response);
        }
    };
}

/** @internal */
export abstract class IpcBusTransportImpl implements IpcBusTransport {
    private static _lastLocalProcessId: number = 0;

    protected _ipcBusPeer: Client.IpcBusPeer;
    protected _promiseConnected: Promise<void>;

    private _localProcessId: number;
    private _ipcCallback: IpcBusTransport.Callback;
    private _requestFunctions: Map<string, DeferredRequest>;
    private _requestNumber: number;
    private _packetDecoder: IpcPacketBuffer;

    constructor(ipcBusContext: Client.IpcBusProcess) {
        this._ipcBusPeer = { id: uuid.v1(), name: '', process: ipcBusContext };
        this._requestFunctions = new Map<string, DeferredRequest>();
        this._requestNumber = 0;
        this._localProcessId = IpcBusTransportImpl._lastLocalProcessId++;
        this._packetDecoder = new IpcPacketBuffer();
    }

    // ----------------------
    // IpcBusClient interface
    // ----------------------
    get peer(): Client.IpcBusPeer {
        return this._ipcBusPeer;
    }

    protected generateName(): string {
        let name = `${this._ipcBusPeer.process.type}_${this._ipcBusPeer.process.pid}`;
        if (this._ipcBusPeer.process.rid) {
            name += `-${this._ipcBusPeer.process.rid}`;
        }
        name += `-${this._localProcessId}`;
        return name;
    }

    protected generateReplyChannel(): string {
        ++this._requestNumber;
        return `${replyChannelPrefix}${this._ipcBusPeer.id}-${this._requestNumber.toString()}`;
    }

    ipcCallback(callback: IpcBusTransport.Callback): void {
        this._ipcCallback = callback;
    }

    protected _onCommandSendMessage(ipcBusCommand: IpcBusCommand, args: any[]) {
        IpcBusUtils.Logger.enable && IpcBusUtils.Logger.info(`[IPCBusTransport] Emit message received on channel '${ipcBusCommand.channel}' from peer #${ipcBusCommand.peer.name}`);
        const ipcBusEvent: Client.IpcBusEvent = { channel: ipcBusCommand.channel, sender: ipcBusCommand.peer };
        if (ipcBusCommand.request) {
            ipcBusEvent.request = {
                resolve: (payload: Object | string) => {
                    ipcBusCommand.request.resolve = true;
                    IpcBusUtils.Logger.enable && IpcBusUtils.Logger.info(`[IPCBusTransport] Resolve request received on channel '${ipcBusCommand.channel}' from peer #${ipcBusCommand.peer.name} - payload: ${JSON.stringify(payload)}`);
                    this.ipcSend(IpcBusCommand.Kind.RequestResponse, ipcBusCommand.request.replyChannel, ipcBusCommand.request, [payload]);
                },
                reject: (err: string) => {
                    ipcBusCommand.request.reject = true;
                    IpcBusUtils.Logger.enable && IpcBusUtils.Logger.info(`[IPCBusTransport] Reject request received on channel '${ipcBusCommand.channel}' from peer #${ipcBusCommand.peer.name} - err: ${JSON.stringify(err)}`);
                    this.ipcSend(IpcBusCommand.Kind.RequestResponse, ipcBusCommand.request.replyChannel, ipcBusCommand.request, [err]);
                }
            };
        }
        this._ipcCallback(ipcBusCommand.channel, ipcBusEvent, ...args);
    }

    protected _onCommandRequestResponse(ipcBusCommand: IpcBusCommand, args: any[]) {
        IpcBusUtils.Logger.enable && IpcBusUtils.Logger.info(`[IPCBusTransport] Emit request response received on channel '${ipcBusCommand.channel}' from peer #${ipcBusCommand.peer.name} (replyChannel '${ipcBusCommand.request.replyChannel}')`);
        const deferredRequest = this._requestFunctions.get(ipcBusCommand.request.replyChannel);
        if (deferredRequest) {
            this._requestFunctions.delete(ipcBusCommand.request.replyChannel);
            deferredRequest.fulFilled(ipcBusCommand, args);
        }
    }

    // We have to simulate a fake first parameter as this function can be called from an Electron ipc with an event
    // or directly from our code.
    protected _onCommandReceived(__ignore__: any, ipcBusCommand: IpcBusCommand, args: any[]) {
        switch (ipcBusCommand.kind) {
            case IpcBusCommand.Kind.SendMessage:
                this._onCommandSendMessage(ipcBusCommand, args);
                break;

            case IpcBusCommand.Kind.RequestResponse:
                this._onCommandRequestResponse(ipcBusCommand, args);
                break;
        }
    }

    protected _onCommandPacketReceived(ipcBusCommand: IpcBusCommand, ipcPacketBuffer: IpcPacketBuffer) {
        const args = ipcPacketBuffer.parseArrayAt(1);
        this._onCommandReceived(undefined, ipcBusCommand, args);
    }

    protected _onCommandBufferReceived(__ignore__: any, ipcBusCommand: IpcBusCommand, buffer: Buffer) {
        this._packetDecoder.decodeFromBuffer(buffer);
        this._onCommandReceived(undefined, this._packetDecoder.parseArrayAt(0), this._packetDecoder.parseArrayAt(1));
    }

    protected decodeBuffer(buffer: Buffer): IpcPacketBuffer {
        this._packetDecoder.decodeFromBuffer(buffer);
        return this._packetDecoder;
    }

    ipcRequest(channel: string, timeoutDelay: number, args: any[]): Promise<Client.IpcBusRequestResponse> {
        if (timeoutDelay == null) {
            timeoutDelay = IpcBusUtils.IPC_BUS_TIMEOUT;
        }
        const ipcBusCommandRequest: IpcBusCommand.Request = {channel, replyChannel: this.generateReplyChannel() };

        const deferredRequest = new DeferredRequest();
        // Register locally
         this._requestFunctions.set(ipcBusCommandRequest.replyChannel, deferredRequest);
         // Execute request
         this.ipcSend(IpcBusCommand.Kind.SendMessage, channel, ipcBusCommandRequest, args);
        // Clean-up
        if (timeoutDelay >= 0) {
            setTimeout(() => {
                if (this._requestFunctions.delete(ipcBusCommandRequest.replyChannel)) {
                    // Unregister remotely
                    this.ipcSend(IpcBusCommand.Kind.RequestCancel, channel, ipcBusCommandRequest);
                    IpcBusUtils.Logger.enable && IpcBusUtils.Logger.info(`[IPCBusTransport] reject: timeout`);
                    const response: Client.IpcBusRequestResponse = { event: { channel: channel, sender: this._ipcBusPeer }, err: 'timeout' };
                    deferredRequest.reject(response);
                }
            }, timeoutDelay);
        }
        return deferredRequest.promise;
    }

    ipcSend(kind: IpcBusCommand.Kind, channel: string, ipcBusCommandRequest?: IpcBusCommand.Request, args?: any[]): void {
        this.ipcPostCommand({ kind, channel, peer: this.peer, request: ipcBusCommandRequest }, args);
    }

    ipcConnect(options: Client.IpcBusClient.ConnectOptions): Promise<void> {
        // Store in a local variable, in case it is set to null (paranoid code as it is asynchronous!)
        let p = this._promiseConnected;
        if (!p) {
            p = this._promiseConnected = this.ipcHandshake(options)
            .then(() => {
                this._ipcBusPeer.name = options.peerName || this.generateName();
                this.ipcSend(IpcBusCommand.Kind.Connect, '');
            })
        }
        return p;
    }

    abstract ipcHandshake(options: Client.IpcBusClient.ConnectOptions): Promise<void>;
    abstract ipcClose(options?: Client.IpcBusClient.CloseOptions): Promise<void>;
    abstract ipcPostCommand(ipcBusCommand: IpcBusCommand, args?: any[]): void;
}
