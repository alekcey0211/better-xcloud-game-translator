import assert from "node:assert/strict";
import test from "node:test";

import { FrameChangeDetector } from "../src/modules/game-translator/frame-change-detector.ts";
import { BrowserTranslationProvider } from "../src/modules/game-translator/browser-translation-provider.ts";
import { DeepLContextTranslationProvider } from "../src/modules/game-translator/deepl-context-translation-provider.ts";
import { createOcrLayout, OCR_LINE_GAP, OCR_LINE_HEIGHT } from "../src/modules/game-translator/ocr-layout.ts";
import { SubtitleDetector } from "../src/modules/game-translator/subtitle-detector.ts";
import { isLikelySubtitleText, MIN_SUBTITLE_OCR_CONFIDENCE } from "../src/modules/game-translator/subtitle-text-filter.ts";
import { SubtitleTracker } from "../src/modules/game-translator/subtitle-tracker.ts";
import { SubtitleScanGate } from "../src/modules/game-translator/subtitle-scan-gate.ts";
import { looksLikeCompleteSubtitle, normalizeText, TextStabilizer } from "../src/modules/game-translator/text-stabilizer.ts";
import { buildDeepLContext, GameTranslationContext } from "../src/modules/game-translator/translation-context.ts";
import { getTranslationDisplayDuration } from "../src/modules/game-translator/translation-retention.ts";

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

test('subtitle detector accepts slightly offset dialogue', () => {
    const detector = new SubtitleDetector();
    const frame = createFrame();
    drawSubtitleStrokes(frame, 120, 250);

    const detection = detector.detect(frame);
    assert.equal(detection.lines.length, 1);
    assert.ok(detection.signature.some(Boolean));
});

test('subtitle crops and signatures ignore isolated background on the same row', () => {
    const detector = new SubtitleDetector();
    const clean = createFrame();
    drawSubtitleStrokes(clean, 210, 430);
    const noisy = createFrame();
    drawSubtitleStrokes(noisy, 210, 430);
    drawSubtitleStrokes(noisy, 40, 100);
    drawSubtitleStrokes(noisy, 530, 600);

    const expected = detector.detect(clean);
    const actual = detector.detect(noisy);
    assert.equal(expected.lines.length, 1);
    assert.deepEqual(actual.lines, expected.lines);
    assert.deepEqual(actual.signature, expected.signature);
});

test('subtitle crops retain word spaces without including adjacent lines', () => {
    const detector = new SubtitleDetector();
    const frame = createFrame();
    drawSubtitleStrokes(frame, 210, 264, 80);
    drawSubtitleStrokes(frame, 276, 420, 80);
    drawSubtitleStrokes(frame, 240, 390, 94);
    const { lines } = detector.detect(frame);

    assert.equal(lines.length, 2);
    assert.ok(lines[0].x <= 210 / frame.width);
    assert.ok(lines[0].x + lines[0].width >= 420 / frame.width);
    assert.ok(lines[0].y + lines[0].height <= lines[1].y);
});

test('subtitle detector uses the entire selected region, including higher dialogue', () => {
    const detector = new SubtitleDetector();
    for (const y of [10, 30, 55, 106, 130]) {
        const frame = createFrame();
        drawSubtitleStrokes(frame, 210, 430, y);
        assert.equal(detector.detect(frame).lines.length, 1, `missed text at y=${y}`);
    }
    const frame = createFrame();
    drawSubtitleStrokes(frame, 210, 430, 30);
    drawSubtitleStrokes(frame, 240, 400, 45);
    assert.equal(detector.detect(frame).lines.length, 2);
});

test('subtitle detector rejects menu-like blocks with more than three lines', () => {
    const detector = new SubtitleDetector();
    const frame = createFrame();
    for (const y of [66, 79, 92, 105]) {
        drawSubtitleStrokes(frame, 210, 430, y);
    }

    const detection = detector.detect(frame);
    assert.equal(detection.lines.length, 0);
    assert.ok(!detection.signature.some(Boolean));
});

test('subtitle tracker waits for a stable position and debounces disappearance', () => {
    const tracker = new SubtitleTracker();
    const line = { x: 0.3, y: 0.65, width: 0.4, height: 0.08 };

    assert.equal(tracker.update([line]), null);
    assert.deepEqual(tracker.update([{ ...line, x: 0.31 }]), [{ ...line, x: 0.31 }]);
    assert.deepEqual(tracker.update([{ ...line, x: 0.29 }]), [{ ...line, x: 0.29 }]);
    assert.equal(tracker.update([]), null);
    assert.deepEqual(tracker.update([]), []);
});

test('OCR layout combines subtitle lines into one compact image in reading order', () => {
    const layout = createOcrLayout([
        { x: 0.25, y: 0.7, width: 0.5, height: 0.1 },
        { x: 0.3, y: 0.5, width: 0.4, height: 0.1 },
    ], 1000, 400);

    assert.equal(layout.lines.length, 2);
    assert.equal(layout.lines[0].sourceY, 200);
    assert.equal(layout.lines[1].sourceY, 280);
    assert.equal(layout.lines[0].targetY, 0);
    assert.equal(layout.lines[1].targetY, OCR_LINE_HEIGHT + OCR_LINE_GAP);
    assert.equal(layout.height, OCR_LINE_HEIGHT * 2 + OCR_LINE_GAP);
    assert.equal(layout.width, Math.round(500 * OCR_LINE_HEIGHT / 40));
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

test('subtitle OCR retries static text at a bounded rate and resets for new dialogue', () => {
    const gate = new SubtitleScanGate();
    const signature = new Uint8Array([0, 1, 1, 0]);
    assert.equal(gate.evaluate(signature, 0.12, 0).shouldScan, true);
    for (const time of [125, 500, 1000, 1499]) {
        assert.equal(gate.evaluate(signature, 0.12, time).shouldScan, false);
    }
    assert.equal(gate.evaluate(signature, 0.12, 1500).shouldScan, true);
    assert.equal(gate.evaluate(signature, 0.12, 1625).shouldScan, false);
    gate.reset();
    assert.equal(gate.evaluate(signature, 0.12, 1700).shouldScan, true);
});

test('subtitle OCR detects cumulative changes instead of forgetting them between ticks', () => {
    const gate = new SubtitleScanGate();
    const signature = new Uint8Array(100).fill(1);
    assert.equal(gate.evaluate(signature, 0.12, 0).shouldScan, true);
    signature.fill(0, 0, 5);
    assert.equal(gate.evaluate(signature, 0.12, 125).shouldScan, false);
    signature.fill(0, 0, 10);
    assert.equal(gate.evaluate(signature, 0.12, 250).shouldScan, false);
    signature.fill(0, 0, 15);
    assert.equal(gate.evaluate(signature, 0.12, 375).shouldScan, true);
});

test('subtitle text filter keeps dialogue and rejects common HUD text', () => {
    assert.equal(MIN_SUBTITLE_OCR_CONFIDENCE, 45);
    assert.ok(isLikelySubtitleText('What?'));
    assert.ok(isLikelySubtitleText("I didn't know"));
    assert.ok(isLikelySubtitleText('Save your breath, brother.'));
    assert.ok(!isLikelySubtitleText('HOLD X TO SKIP'));
    assert.ok(!isLikelySubtitleText('OBJECTIVE UPDATED'));
    assert.ok(!isLikelySubtitleText('Ammo 12 / 30'));
    assert.ok(isLikelySubtitleText('Open door'));
    for (const text of ['No', 'Go', 'What', 'Thank you', 'Hold a moment', 'Map out a route']) {
        assert.ok(isLikelySubtitleText(text), `rejected dialogue: ${text}`);
    }
    for (const text of ['Inventory', '||||| @@', 'TTTT', 'Сохранение', 'PRESS TO CONTINUE']) {
        assert.ok(!isLikelySubtitleText(text), `accepted noise: ${text}`);
    }
});

test('translation display time gives longer lines enough reading time', () => {
    assert.equal(getTranslationDisplayDuration('Короткая реплика', 5000), 5000);
    assert.equal(getTranslationDisplayDuration('а'.repeat(100), 5000), 6500);
    assert.equal(getTranslationDisplayDuration('а'.repeat(300), 5000), 12000);
    assert.equal(getTranslationDisplayDuration('Короткая реплика', 8000), 8000);
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
