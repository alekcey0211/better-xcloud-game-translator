import { DEFAULT_GAME_DICTIONARY } from "../../src/modules/game-translator/dictionary-catalog.ts";
import { DictionaryTranslationProvider } from "../../src/modules/game-translator/dictionary-translation-provider.ts";

const $result = document.querySelector('#result')!;
const provider = new DictionaryTranslationProvider(() => DEFAULT_GAME_DICTIONARY, window.fetch);

try {
    await provider.prepare();
    const signal = new AbortController().signal;
    const found = await provider.translate('Go. Away.', 'en', 'ru', signal);
    const missing = await provider.translate('Unrelated fictional dialogue.', 'en', 'ru', signal);
    if (found !== 'Иди. Прочь.' || missing !== '') {
        throw new Error(`Unexpected lookup results: ${JSON.stringify({ found, missing })}`);
    }
    $result.textContent = 'PASS: real browser fetch loaded the published dictionary; Go. Away. → Иди. Прочь.; unknown dialogue → empty.';
} catch (error) {
    $result.textContent = `FAIL: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
} finally {
    provider.destroy();
}
