import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";

import { DEFAULT_GAME_DICTIONARY, GAME_DICTIONARIES } from "../src/modules/game-translator/dictionary-catalog.ts";
import { DictionaryTranslationProvider } from "../src/modules/game-translator/dictionary-translation-provider.ts";
import { dictionaryCandidates, GameDictionary, unrealSourceHash } from "../src/modules/game-translator/game-dictionary.ts";
import { TextStabilizer } from "../src/modules/game-translator/text-stabilizer.ts";

function payload(pairs: [string, string][]) {
    return {
        schema: 1, id: DEFAULT_GAME_DICTIONARY, sourceLanguage: 'en', targetLanguage: 'ru',
        strings: pairs.map(pair => pair[1]),
        entries: pairs.map((pair, index) => [unrealSourceHash(pair[0]), index]),
    };
}

const file = GAME_DICTIONARIES[DEFAULT_GAME_DICTIONARY].url.split('/').at(-1)!;
const packBytes = readFileSync(new URL(`../.github/pages/dictionaries/${file}`, import.meta.url));
const pack = JSON.parse(packBytes.toString());
const actualDictionary = new GameDictionary(pack, DEFAULT_GAME_DICTIONARY);
const signal = new AbortController().signal;

test('published pack matches its content-addressed URL and contains only unique hashes', () => {
    assert.ok(file.includes(createHash('sha256').update(packBytes).digest('hex').slice(0, 12)));
    assert.equal(pack.entries.length, 35692);
    assert.equal(pack.stats.ambiguousHashesExcluded, 426);
    assert.equal(new Set(pack.entries.map((entry: number[]) => entry[0])).size, pack.entries.length);
});

test('Unreal CRC32 matches independently extracted source hashes', () => {
    assert.equal(unrealSourceHash('Um, alright. Not moving.'), 1202719369);
    assert.equal(unrealSourceHash('Go. Away.'), 3821555048);
    assert.equal(unrealSourceHash(''), 0);
});

test('real pack supports speaker prefixes, OCR pipe correction and missing punctuation', () => {
    assert.equal(actualDictionary.lookup('Coen: Um, alright. Not moving.'), 'Эм, хорошо. Не двигаюсь.');
    assert.equal(actualDictionary.lookup('Uriash Hermit: Human not listen. | say slow:'), 'Человек не слушать. Я говорить медленно:');
    assert.equal(actualDictionary.lookup('Uriash Hermit: Go. Away'), 'Иди. Прочь.');
    assert.equal(actualDictionary.lookup('Uriash Hermit: Go.   Away.'), 'Иди. Прочь.');
});

test('unknown, HUD, partial, empty and oversized OCR never produce a translation', () => {
    for (const text of ['', 'HP 100 / 100', 'Quest updated', 'Move the Quest window', 'Came here by accident', 'Unrelated fictional dialogue.', 'a'.repeat(501)]) {
        assert.equal(actualDictionary.lookup(text), '', text);
    }
    assert.ok(dictionaryCandidates('Someone: Now, tell: why here?').length <= 32);
});

test('ambiguous corrections are silent, and different punctuation is not conflated', () => {
    const dictionary = new GameDictionary(payload([['Go.', 'Уходи.'], ['Go?', 'Идти?']]), DEFAULT_GAME_DICTIONARY);
    assert.equal(dictionary.lookup('Go'), '');
    assert.equal(dictionary.lookup('Go.'), 'Уходи.');
    assert.equal(dictionary.lookup('Go?'), 'Идти?');
    assert.equal(dictionary.lookup('go.'), '');
    assert.equal(dictionary.lookup('G0.'), '');
});

test('malformed packs, wrong game/languages, invalid indices and duplicate hashes are rejected', () => {
    const valid = payload([['Hello.', 'Привет.']]);
    for (const invalid of [null, {}, { ...valid, id: 'wrong' }, { ...valid, sourceLanguage: 'ru' },
        { ...valid, schema: 2 }, { ...valid, strings: [null] }, { ...valid, strings: [''] },
        { ...valid, entries: [[-1, 0]] }, { ...valid, entries: [[1, 999]] },
        { ...valid, entries: [...valid.entries, ...valid.entries] }]) {
        assert.throws(() => new GameDictionary(invalid, DEFAULT_GAME_DICTIONARY));
    }
});

test('dictionary downloads once, sends no OCR and has no fallback for misses', async () => {
    const requests: { input: string; init?: RequestInit }[] = [];
    const provider = new DictionaryTranslationProvider(() => DEFAULT_GAME_DICTIONARY, async (input, init) => {
        requests.push({ input: input.toString(), init });
        return new Response(JSON.stringify(pack));
    });
    try {
        const [first, second] = await Promise.all([
            provider.translate('Coen: Um, alright. Not moving.', 'en', 'ru', signal),
            provider.translate('Not in this dictionary', 'en', 'ru', signal),
        ]);
        assert.equal(first, 'Эм, хорошо. Не двигаюсь.');
        assert.equal(second, '');
        assert.equal(await provider.translate('Unknown again.', 'en', 'ru', signal), '');
        assert.equal(requests.length, 1);
        assert.equal(requests[0].input, GAME_DICTIONARIES[DEFAULT_GAME_DICTIONARY].url);
        assert.equal(requests[0].init?.body, undefined);
        assert.equal(requests[0].init?.credentials, 'omit');
    } finally {
        provider.destroy();
    }
});

test('failed download is throttled and never replaced with online translation', async () => {
    let requests = 0;
    const provider = new DictionaryTranslationProvider(() => DEFAULT_GAME_DICTIONARY, async () => {
        requests++;
        return new Response('', { status: 503 });
    });
    try {
        await assert.rejects(provider.prepare(), /HTTP 503/);
        await assert.rejects(provider.translate('Hello.', 'en', 'ru', signal), /HTTP 503/);
        assert.equal(requests, 1);
    } finally {
        provider.destroy();
    }
});

test('unknown catalog entry and unsupported languages do not make network requests', async () => {
    const provider = new DictionaryTranslationProvider(() => '__proto__', async () => {
        assert.fail('Must not fetch an unknown pack');
    });
    await assert.rejects(provider.prepare(), /Select a game dictionary/);
    assert.equal(await provider.translate('Hello.', 'ru', 'en', signal), '');
});

test('cancelled subtitle cannot display after a shared download finishes', async () => {
    let release: (response: Response) => void = () => {};
    const provider = new DictionaryTranslationProvider(() => DEFAULT_GAME_DICTIONARY, () => new Promise(resolve => { release = resolve; }));
    const controller = new AbortController();
    const pending = provider.translate('Go. Away.', 'en', 'ru', controller.signal);
    controller.abort();
    release(new Response(JSON.stringify(pack)));
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(await provider.translate('Go. Away.', 'en', 'ru', signal), 'Иди. Прочь.');
    provider.destroy();
});

test('changing the selected game cancels the previous dictionary download', async () => {
    let id = DEFAULT_GAME_DICTIONARY as string;
    let release: (response: Response) => void = () => {};
    let downloadSignal: AbortSignal | null | undefined;
    const provider = new DictionaryTranslationProvider(() => id, (_input, init) => {
        downloadSignal = init?.signal;
        return new Promise(resolve => { release = resolve; });
    });
    const pending = provider.prepare();
    id = 'unknown-game';
    await assert.rejects(provider.prepare(), /Select a game dictionary/);
    assert.equal(downloadSignal?.aborted, true);
    release(new Response(JSON.stringify(pack)));
    await assert.rejects(pending, { name: 'AbortError' });
    provider.destroy();
});

test('dictionary stabilization retries punctuation/case corrections and resets on game change', async () => {
    const emitted: string[] = [];
    const stabilizer = new TextStabilizer(0, text => emitted.push(text), true);
    const push = async (text: string) => {
        stabilizer.push(text);
        await new Promise(resolve => setTimeout(resolve, 5));
    };
    try {
        await push('Go?');
        await push('Go.');
        await push('go.');
        await push('go.');
        stabilizer.setExactMatching(true);
        await push('go.');
        assert.deepEqual(emitted, ['Go?', 'Go.', 'go.', 'go.']);
    } finally {
        stabilizer.reset();
    }
});

test('a transient OCR candidate is cancelled when the displayed line returns', async () => {
    const emitted: string[] = [];
    const stabilizer = new TextStabilizer(0, text => emitted.push(text), true);
    try {
        stabilizer.push('Go.');
        await new Promise(resolve => setTimeout(resolve, 5));
        stabilizer.setDelay(20);
        stabilizer.push('No.');
        stabilizer.push('Go.');
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.deepEqual(emitted, ['Go.']);
    } finally {
        stabilizer.reset();
    }
});

test('native-style fetch is called without a provider receiver', async () => {
    const provider = new DictionaryTranslationProvider(() => DEFAULT_GAME_DICTIONARY, function (this: unknown) {
        assert.equal(this, undefined, 'Native fetch rejects the provider as this (Illegal invocation)');
        return Promise.resolve(new Response(JSON.stringify(pack)));
    });
    try {
        assert.equal(await provider.translate('Go. Away.', 'en', 'ru', signal), 'Иди. Прочь.');
    } finally {
        provider.destroy();
    }
});

test('synchronous transport errors are throttled and returned as promise rejections', async () => {
    let calls = 0;
    const provider = new DictionaryTranslationProvider(() => DEFAULT_GAME_DICTIONARY, () => {
        calls++;
        throw new TypeError('Transport failed synchronously');
    });
    try {
        await assert.rejects(provider.prepare(), /Transport failed synchronously/);
        await assert.rejects(provider.prepare(), /Transport failed synchronously/);
        assert.equal(calls, 1);
    } finally {
        provider.destroy();
    }
});
