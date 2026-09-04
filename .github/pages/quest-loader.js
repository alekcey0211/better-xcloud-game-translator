// ==UserScript==
// @name         Better xCloud Game Translator loader
// @namespace    https://github.com/alekcey0211/better-xcloud-game-translator
// @version      1.0.0
// @description  Loads the latest Better xCloud Game Translator build from GitHub Pages
// @match        https://www.xbox.com/*/play*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const scriptUrl = 'https://alekcey0211.github.io/better-xcloud-game-translator/better-xcloud.user.js';
    const cacheKey = 'better-xcloud-game-translator:script';
    let source = '';

    try {
        const request = new XMLHttpRequest();
        request.open('GET', `${scriptUrl}?time=${Date.now()}`, false);
        request.send();

        if (request.status >= 200 && request.status < 300) {
            source = request.responseText;
            localStorage.setItem(cacheKey, source);
        }
    } catch (error) {
        console.warn('[Better xCloud Game Translator] Could not download the latest build', error);
    }

    if (!source) {
        source = localStorage.getItem(cacheKey) || '';
    }

    if (!source) {
        alert('Better xCloud Game Translator: не удалось загрузить скрипт из GitHub.');
        return;
    }

    try {
        (0, eval)(`${source}\n//# sourceURL=${scriptUrl}`);
    } catch (error) {
        console.error('[Better xCloud Game Translator] Could not start the downloaded build', error);
        alert('Better xCloud Game Translator: скрипт загружен, но не смог запуститься.');
    }
})();
