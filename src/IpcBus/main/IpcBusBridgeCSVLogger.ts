/// <reference types='electron' />

import * as path from 'path';
import * as fs from 'fs';

const csvWriter = require('csv-write-stream');

import * as Client from '../IpcBusClient';
import { IpcBusCommand } from '../IpcBusCommand';
import { JSON_stringify } from '../IpcBusUtils';
import { IpcBusBridgeLogger } from './IpcBusBridgeLogger';

// This class ensures the transfer of data between Broker and Renderer/s using ipcMain
/** @internal */
export class IpcBusBridgeCSVLogger extends IpcBusBridgeLogger {
    private _logger: any;
    private _line: number;

    constructor(contextType: Client.IpcBusProcessType, logPath: string) {
        super(contextType);

        this._line = 0;

        !fs.existsSync(logPath) && fs.mkdirSync(logPath);

        this._logger = csvWriter({ separator: ';', headers: [
            '#',
            'kind',
            'peer id',
            'peer context',
            'arg0',
            'arg1',
            'arg2',
            'arg3',
            'arg4',
            'arg5'
        ]});
        this._logger.pipe(fs.createWriteStream(path.join(logPath, 'electron-common-ipcbus-bridge.csv')));
    }

    protected addLog(ipcBusCommand: IpcBusCommand, args: any[]): any {
        const peer = ipcBusCommand.peer;
        ++this._line;
        const log: string[] = [
            this._line.toString(),
            ipcBusCommand.kind,
            peer.id, JSON.stringify(peer.process)
        ];
        if (args) {
            for (let i = 0, l = args.length; i < l; ++i) {
                log.push(JSON_stringify(args[i], 255));
            }
        }
        this._logger.write(log);
    }
}

