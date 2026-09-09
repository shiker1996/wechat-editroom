const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBridge', {
  isDesktop: true,
  platform: process.platform,
  onCommand(handler) {
    if (typeof handler !== 'function') return () => {};
    // 与 Electron 官方 main-to-renderer 示例一致：每次调用只注册一个
    // 长生命周期 listener，直到渲染器主动取消订阅。
    const listener = (_event, message) => {
      ipcRenderer.send('desktop-command-trace', {
        stage: 'preload-received',
        id: message?.id,
        command: message?.command,
      });
      handler(message);
    };
    ipcRenderer.on('desktop-command', listener);
    return () => ipcRenderer.removeListener('desktop-command', listener);
  },
  ready() {
    ipcRenderer.send('desktop-renderer-ready');
  },
  trace(details) {
    if (!details || typeof details !== 'object') return;
    ipcRenderer.send('desktop-command-trace', details);
  },
});
