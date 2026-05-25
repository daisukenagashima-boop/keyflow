'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('numpad', {
  getInfo:            () => ipcRenderer.invoke('get-server-info'),
  onInfo:             (cb) => ipcRenderer.on('server-info', (_, info) => cb(info)),
  getAccessibility:   () => ipcRenderer.invoke('get-accessibility'),
  openAccessibility:  () => ipcRenderer.send('open-accessibility'),
});
