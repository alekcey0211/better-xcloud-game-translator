import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createWorker, OEM, PSM } from "tesseract.js";

import { DEFAULT_GAME_DICTIONARY, GAME_DICTIONARIES } from "../src/modules/game-translator/dictionary-catalog.ts";
import { GameDictionary } from "../src/modules/game-translator/game-dictionary.ts";
import { SubtitleDetector } from "../src/modules/game-translator/subtitle-detector.ts";
import { SubtitleTracker } from "../src/modules/game-translator/subtitle-tracker.ts";
import { isLikelySubtitleText, MIN_SUBTITLE_OCR_CONFIDENCE } from "../src/modules/game-translator/subtitle-text-filter.ts";
import { normalizeText } from "../src/modules/game-translator/text-stabilizer.ts";
import { createPgm, decodeFixture } from "./helpers/game-translator-video.ts";

const directory = fileURLToPath(new URL('./fixtures/game-translator/quest-2026-09-05/', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8')) as {
    width: number;
    height: number;
    samples: { id: string; timeSeconds: number; file: string; expectedText: string; expectedDictionaryText: string }[];
};

const dictionaryFile = GAME_DICTIONARIES[DEFAULT_GAME_DICTIONARY].url.split('/').at(-1)!;
const dictionary = new GameDictionary(JSON.parse(readFileSync(new URL(`../.github/pages/dictionaries/${dictionaryFile}`, import.meta.url), 'utf8')), DEFAULT_GAME_DICTIONARY);

test('Quest recording: real subtitle crops reach the translation input without background noise', { timeout: 120000 }, async t => {
    const cachePath = fileURLToPath(new URL('../.cache/tesseract/', import.meta.url));
    mkdirSync(cachePath, { recursive: true });
    const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
        cachePath,
    });
    try {
        await worker.setParameters({
            tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
            preserve_interword_spaces: '1',
            user_defined_dpi: '180',
        });
        for (const sample of manifest.samples) {
            await t.test(`${sample.timeSeconds}s: ${sample.id}`, async sampleTest => {
                const path = resolve(directory, sample.file);
                const detectionFrame = decodeFixture(path, 640, 140);
                const ocrFrame = decodeFixture(path, manifest.width, manifest.height);
                const detection = new SubtitleDetector().detect(detectionFrame);
                const tracker = new SubtitleTracker();
                // Two observations of a static fixture test confirmation, not head motion.
                assert.equal(tracker.update(detection.lines), null);
                const lines = tracker.update(detection.lines)!;
                let acceptedText = '';
                let rawText = '';
                let confidence = 0;
                if (lines.length) {
                    const { data } = await worker.recognize(createPgm(ocrFrame, lines));
                    rawText = data.text.replace(/\s+/g, ' ').trim();
                    confidence = data.confidence;
                    if (confidence >= MIN_SUBTITLE_OCR_CONFIDENCE && isLikelySubtitleText(rawText)) {
                        acceptedText = rawText;
                    }
                }
                const diagnostic = JSON.stringify({ lines: lines.length, confidence, rawText });
                const actual = normalizeText(acceptedText);
                const expected = normalizeText(sample.expectedText);
                if (expected) {
                    // Missing/reordered dialogue must fail as well as extra OCR text.
                    const words = actual.split(' ');
                    let index = 0;
                    for (const word of expected.split(' ')) {
                        index = words.indexOf(word, index);
                        assert.ok(index >= 0, `missing ${word}: ${diagnostic}`);
                        index++;
                    }
                }
                await sampleTest.test('dictionary-only translation from real OCR', () => {
                    assert.equal(dictionary.lookup(acceptedText), sample.expectedDictionaryText, diagnostic);
                });
                // Full normalized equality catches extra OCR text as well as missing words.
                await sampleTest.test('no extra OCR words', () => assert.equal(actual, expected, diagnostic));
            });
        }
    } finally {
        await worker.terminate();
    }
});
