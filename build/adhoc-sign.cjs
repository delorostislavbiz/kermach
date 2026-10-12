// Подпись ad-hoc после сборки: у Apple Silicon программа без подписи не запускается, а сертификата разработчика нет.
// electron-builder с identity: null не подписывает вовсе — подписываем «-» (ad-hoc) всё .app целиком.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log(`  • ad-hoc подпись: ${app}`);
};
