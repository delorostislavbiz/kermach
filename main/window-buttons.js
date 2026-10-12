// @ts-check
// Кнопки своего заголовка — «свернуть», «развернуть», «закрыть» — для любого окна программы без системной рамки.
// Обработчики вешает первое открывшееся окно, один раз на процесс: при запуске с --project окно «Проекты» не открывается вовсе.
const { BrowserWindow, ipcMain } = require('electron');
const sender = require('./sender');

let done = false;

function register() {
  if (done) return;
  done = true;
  ipcMain.on('win:min', (e) => {
    if (!sender.allowed(e, 'win:min')) return;
    BrowserWindow.fromWebContents(e.sender)?.minimize();
  });
  ipcMain.on('win:max', (e) => {
    if (!sender.allowed(e, 'win:max')) return;
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w) w.isMaximized() ? w.unmaximize() : w.maximize();
  });
  ipcMain.on('win:close', (e) => {
    if (!sender.allowed(e, 'win:close')) return;
    BrowserWindow.fromWebContents(e.sender)?.close();
  });
}

module.exports = { register };
