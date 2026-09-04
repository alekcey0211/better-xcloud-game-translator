import assert from "node:assert/strict";
import test from "node:test";

import { FrameChangeDetector } from "../src/modules/game-translator/frame-change-detector.ts";
import { BrowserTranslationProvider } from "../src/modules/game-translator/browser-translation-provider.ts";
import { DeepLContextTranslationProvider } from "../src/modules/game-translator/deepl-context-translation-provider.ts";
import { SubtitleDetector } from "../src/modules/game-translator/subtitle-detector.ts";
import { looksLikeCompleteSubtitle, normalizeText, TextStabilizer } from "../src/modules/game-translator/text-stabilizer.ts";
import { buildDeepLContext, GameTranslationContext } from "../src/modules/game-translator/translation-context.ts";

function createFrame(width = 640, height = 140) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < data.length; index += 4) {
        data[index] = 20;
        data[index + 1] = 20;
        data[index + 2] = 20;
        data[index + 3] = 255;
    }

    return { data, width, height };
}

function drawSubtitleStrokes(frame: ReturnType<typeof createFrame>, x0: number, x1: number, y0 = 106) {
    for (let x = x0; x <= x1; x += 9) {
        for (let y = y0; y < y0 + 8; y++) {
            for (let offset = 0; offset < 2; offset++) {
                const dataIndex = (y * frame.width + x + offset) * 4;
                frame.data[dataIndex] = 235;
                frame.data[dataIndex + 1] = 232;
                frame.data[dataIndex + 2] = 220;
            }
        }
    }
}

test('subtitle detector accepts centered text-like lines and rejects corner UI', () => {
    const detector = new SubtitleDetector();
    const subtitleFrame = createFrame();
    drawSubtitleStrokes(subtitleFrame, 210, 430);
    const subtitle = detector.detect(subtitleFrame);

    assert.equal(subtitle.lines.length, 1);
    assert.ok(subtitle.lines[0].x < 0.4);
    assert.ok(subtitle.lines[0].x + subtitle.lines[0].width > 0.6);
    assert.ok(subtitle.signature.some(Boolean));

    const cornerFrame = createFrame();
    drawSubtitleStrokes(cornerFrame, 35, 95);
    const corner = detector.detect(cornerFrame);
    assert.equal(corner.lines.length, 0);
    assert.ok(!corner.signature.some(Boolean));
});

test('subtitle-aware change score ignores empty frames and detects changed text', () => {
    const changeDetector = new FrameChangeDetector();
    const empty = new Uint8Array(20);
    assert.equal(changeDetector.compare(empty), 0);
    assert.equal(changeDetector.compare(empty), 0);

    const firstLine = new Uint8Array(20);
    firstLine[5] = 1;
    firstLine[6] = 1;
    assert.equal(changeDetector.compare(firstLine), 1);
    assert.equal(changeDetector.compare(firstLine), 0);

    const nextLine = new Uint8Array(20);
    nextLine[12] = 1;
    nextLine[13] = 1;
    assert.equal(changeDetector.compare(nextLine), 1);
});

test('normalization and complete-subtitle detection handle game dialogue punctuation', () => {
    assert.equal(normalizeText('  I need   your help! '), 'i need your help');
    assert.ok(looksLikeCompleteSubtitle('I need your help!'));
    assert.ok(looksLikeCompleteSubtitle("Coen: I didn't know —"));
    assert.ok(!looksLikeCompleteSubtitle('I need your'));
});

test('complete subtitle uses the fast stabilization path', async () => {
    const startedAt = performance.now();
    const elapsed = await new Promise<number>(resolve => {
        const stabilizer = new TextStabilizer(500, () => resolve(performance.now() - startedAt));
        stabilizer.push('Ready!', true);
    });

    assert.ok(elapsed < 250, `expected fast stabilization, got ${elapsed} ms`);
});

test('browser translator downloads once, reuses the model, and forwards cancellation', async () => {
    let createCalls = 0;
    let destroyCalls = 0;
    let translatedSignal: AbortSignal | undefined;
    const progressValues: number[] = [];
    const previousWindow = globalThis.window;

    globalThis.window = {
        Translator: {
            availability: async () => 'downloadable',
            create: async ({ monitor }: { monitor?: (target: EventTarget) => void }) => {
                createCalls++;
                const target = new EventTarget();
                monitor?.(target);
                const event = new Event('downloadprogress');
                Object.defineProperty(event, 'loaded', { value: 0.75 });
                target.dispatchEvent(event);

                return {
                    translate: async (_text: string, options?: { signal?: AbortSignal }) => {
                        translatedSignal = options?.signal;
                        return '  Привет!  ';
                    },
                    destroy: () => destroyCalls++,
                };
            },
        },
    } as unknown as Window & typeof globalThis;

    try {
        const provider = new BrowserTranslationProvider();
        const firstPreparation = await provider.prepare('en', 'ru', progress => progressValues.push(progress));
        const secondPreparation = await provider.prepare('en', 'ru');
        const controller = new AbortController();
        const translated = await provider.translate('Hello!', 'en', 'ru', controller.signal);

        assert.deepEqual(firstPreparation, { availability: 'downloadable', created: true });
        assert.deepEqual(secondPreparation, { availability: 'available', created: false });
        assert.deepEqual(progressValues, [0.75]);
        assert.equal(createCalls, 1);
        assert.equal(translated, 'Привет!');
        assert.equal(translatedSignal, controller.signal);

        provider.destroy();
        await Promise.resolve();
        assert.equal(destroyCalls, 1);
    } finally {
        globalThis.window = previousWindow;
    }
});

test('browser translator reports an unsupported browser', async () => {
    const previousWindow = globalThis.window;
    globalThis.window = {} as Window & typeof globalThis;

    try {
        const provider = new BrowserTranslationProvider();
        await assert.rejects(provider.prepare('en', 'ru'), /unavailable/);
    } finally {
        globalThis.window = previousWindow;
    }
});

test('game translation context keeps compact game metadata and two previous subtitles', () => {
    const context = new GameTranslationContext();
    context.reset('  Still   Wakes the Deep ');
    context.setGameDescription('Narrative horror\n game set on an offshore oil rig.');
    context.rememberSubtitle('First line.');
    context.rememberSubtitle('Second line.');
    context.rememberSubtitle('Third line.');

    assert.equal(
        buildDeepLContext(context.snapshot()),
        'Game title: Still Wakes the Deep\n' +
        'Game description: Narrative horror game set on an offshore oil rig.\n' +
        'Previous dialogue:\nSecond line.\nThird line.',
    );
});

test('DeepL Context provider sends context through the configured proxy', async () => {
    let requestUrl = '';
    let requestInit: RequestInit | undefined;
    const provider = new DeepLContextTranslationProvider(
        () => 'https://translator.example.com/v2/translate',
        async (input, init) => {
            requestUrl = input.toString();
            requestInit = init;
            return new Response(JSON.stringify({ translations: [{ text: '  Мне нужна помощь.  ' }] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        },
    );
    const controller = new AbortController();
    const translated = await provider.translate('I need help.', 'en', 'ru', controller.signal, {
        gameTitle: 'Still Wakes the Deep',
        gameDescription: 'Narrative horror game.',
        previousSubtitles: ['Are you all right?'],
    });

    assert.equal(translated, 'Мне нужна помощь.');
    assert.equal(requestUrl, 'https://translator.example.com/v2/translate');
    assert.equal(requestInit?.method, 'POST');
    assert.equal(requestInit?.signal, controller.signal);
    assert.deepEqual(JSON.parse(String(requestInit?.body)), {
        text: ['I need help.'],
        source_lang: 'EN',
        target_lang: 'RU',
        context: 'Game title: Still Wakes the Deep\n' +
            'Game description: Narrative horror game.\n' +
            'Previous dialogue:\nAre you all right?',
    });
});

test('DeepL Context provider requires a configured HTTPS proxy', async () => {
    const fetcher = async () => new Response();
    const missingProxy = new DeepLContextTranslationProvider(() => '', fetcher);
    const insecureProxy = new DeepLContextTranslationProvider(() => 'http://translator.example.com', fetcher);

    await assert.rejects(missingProxy.prepare(), /not configured/);
    await assert.rejects(insecureProxy.prepare(), /must use HTTPS/);
});
