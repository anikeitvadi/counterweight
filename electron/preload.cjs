const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('cryptodesk', { isElectron: true, platform: process.platform });
