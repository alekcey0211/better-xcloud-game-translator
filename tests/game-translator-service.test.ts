import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GameTranslatorProvider } from '../src/enums/pref-values';
import { DEFAULT_GAME_DICTIONARY, GAME_DICTIONARIES } from '../src/modules/game-translator/dictionary-catalog';
const file = GAME_DICTIONARIES[DEFAULT_GAME_DICTIONARY].url.split('/').at(-1)!;
const pack = readFileSync(new URL(`../.github/pages/dictionaries/${file}`, import.meta.url), 'utf8');
const requests: string[] = [];
(globalThis as any).window = {
    navigator: { userAgent: 'Dictionary integration test' },
    fetch: async (input: string | URL | Request) => {
        requests.push(input.toString());
        if (!input.toString().includes('/dictionaries/')) throw new Error('Unexpected online translator request');
        return new Response(pack);
    },
};
const { TranslationService } = await import('../src/modules/game-translator/translation-service');
const service = new TranslationService(() => '', () => DEFAULT_GAME_DICTIONARY);
try {
    await service.prepare(GameTranslatorProvider.DICTIONARY);
    const signal = new AbortController().signal;
    const missed = await service.translate(GameTranslatorProvider.DICTIONARY, 'Go. Away?', signal);
    const found = await service.translate(GameTranslatorProvider.DICTIONARY, 'Go. Away.', signal);
    const repeated = await service.translate(GameTranslatorProvider.DICTIONARY, 'Go. Away.', signal);
    const repeatedMiss = await service.translate(GameTranslatorProvider.DICTIONARY, 'Go. Away?', signal);
    assert.equal(missed.text, '');
    assert.equal(found.text, 'Иди. Прочь.');
    assert.equal(repeated.cacheHit, true);
    assert.equal(repeatedMiss.cacheHit, true);
    assert.equal(repeatedMiss.text, '');
    assert.equal(requests.length, 1);
    console.log('PASS: actual TranslationService uses dictionary only; punctuation-sensitive positive and negative cache; one static download');
} finally {
    service.destroy();
}
