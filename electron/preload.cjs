const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('counterweight', { isElectron: true, platform: process.platform });
