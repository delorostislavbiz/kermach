// @ts-check
// Номер версії програми (порт для macOS): version з package.json плюс номер Mac-збірки macBuild — 1.0.5 і macBuild 1 дають 1.0.5.1.
// Так Mac-випуск між версіями Ростислава (тег v1.0.5.1-mac) новіший за 1.0.5 і старший за 1.0.6: «Перевірити оновлення» (update.js) рахує
// номери частинами. version лишається semver — його вимагає electron-builder; CFBundleVersion — build.mac.bundleVersion.
const pkg = require('../package.json');
/** @returns {string} */
const appVersion = () => (pkg.macBuild ? `${pkg.version}.${pkg.macBuild}` : pkg.version);
module.exports = { appVersion };
