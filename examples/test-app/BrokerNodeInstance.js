//////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Electron Test App

'use strict';

console.log('IPC Broker instance : Starting')

const ipcBusModule = require('electron-common-ipc');
const ipcBroker = ipcBusModule.IpcBusBroker.Create();
ipcBusModule.ActivateIpcBusTrace(true);

function GetCmdLineArgValue(argName)  {
    for (let i = 0; i < process.argv.length; ++i) {
        if (process.argv[i].startsWith('--' + argName)) {
            const argValue = process.argv[i].split('=')[1];
            return argValue;
        }
    }
    return null;
}

let busPath = GetCmdLineArgValue('bus-path');
console.log(busPath);

ipcBroker.connect(busPath)
    .then((msg) => {
        console.log('IPC Broker instance : Started');

        process.send({ event: 'ready' });
    })
    .catch((err) => {
        console.log('IPC Broker instance : ' + err);
    });
    

function dispatchMessage(msg)
{
    console.log('IPC Broker instance : receive message:' + JSON.stringify(msg));
     var msgJSON = JSON.parse(msg);
     if (msgJSON.action === 'queryState') {
         let queryState = ipcBroker.queryState();
         process.send({event: 'queryState', result: queryState});
     }
}

process.on('message', dispatchMessage);