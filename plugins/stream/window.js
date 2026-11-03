// @ts-check
// Плагин «Сцена стрима» (t1589): своего вида в окне нет. Окно только запускает главную часть (main.js рядом),
// а она отдаёт доску проекта по местному адресу 127.0.0.1 для сцены в браузере или OBS.
// Выключили плагин — мост зовёт stop() главной части, сервер закрывается.

/** @param {any} host */
function streamSetup(host) {
  // Язык сцены — язык окна Kermach (I18n.lang(): '' — русский, иначе ru, uk, en, de).
  const w = /** @type {any} */ (window);
  const lang = w.I18n && typeof w.I18n.lang === 'function' ? w.I18n.lang() : '';
  Promise.resolve(host.call('start', lang)).then((/** @type {any} */ r) => {
    if (r && r.error) host.log(`сцена стрима не запущена: ${r.error}`);
  }).catch((/** @type {any} */ e) => host.log(`сцена стрима не запущена: ${(e && e.message) || e}`));
  return () => {};
}

if (typeof kermachPlugin === 'function') kermachPlugin(streamSetup);
