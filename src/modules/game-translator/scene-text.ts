import type { PixelFrame } from "./subtitle-detector";
import { normalizeText } from "./text-stabilizer.ts";

const SIGNATURE_COLUMNS = 32;
const SIGNATURE_ROWS = 18;
const MAX_SCENE_TEXT_LENGTH = 160;
export const MIN_SCENE_OCR_CONFIDENCE = 60;

export function createSceneSignature(frame: PixelFrame) {
    const signature = new Uint8Array(SIGNATURE_COLUMNS * SIGNATURE_ROWS);

    for (let row = 0; row < SIGNATURE_ROWS; row++) {
        const y0 = Math.floor(row * frame.height / SIGNATURE_ROWS);
        const y1 = Math.max(y0 + 1, Math.floor((row + 1) * frame.height / SIGNATURE_ROWS));
        for (let column = 0; column < SIGNATURE_COLUMNS; column++) {
            const x0 = Math.floor(column * frame.width / SIGNATURE_COLUMNS);
            const x1 = Math.max(x0 + 1, Math.floor((column + 1) * frame.width / SIGNATURE_COLUMNS));
            const stepX = Math.max(1, Math.floor((x1 - x0) / 4));
            const stepY = Math.max(1, Math.floor((y1 - y0) / 4));
            let total = 0;
            let samples = 0;
            let darkest = 255;
            let brightest = 0;

            for (let y = y0; y < y1; y += stepY) {
                for (let x = x0; x < x1; x += stepX) {
                    const index = (y * frame.width + x) * 4;
                    const luminance = (
                        54 * frame.data[index]
                        + 183 * frame.data[index + 1]
                        + 19 * frame.data[index + 2]
                    ) >> 8;
                    total += luminance;
                    samples++;
                    darkest = Math.min(darkest, luminance);
                    brightest = Math.max(brightest, luminance);
                }
            }

            const averageBucket = Math.floor(total / samples / 16);
            const contrastBucket = Math.floor((brightest - darkest) / 16);
            signature[row * SIGNATURE_COLUMNS + column] = averageBucket * 16 + contrastBucket;
        }
    }

    return signature;
}

export function isLikelyEnglishSceneText(rawText: string, confidence = 100) {
    const text = rawText.replace(/\s+/g, ' ').trim();
    const normalized = normalizeText(text);
    if (!normalized || normalized.length > MAX_SCENE_TEXT_LENGTH || /https?:\/\//i.test(text)) {
        return false;
    }

    const letters = text.match(/\p{L}/gu)?.length || 0;
    const latinLetters = text.match(/[a-z]/gi)?.length || 0;
    const visibleCharacters = text.match(/\S/g)?.length || 0;
    const expectedCharacters = text.match(/[a-z0-9.,!?':;()\[\]\/&+%-]/gi)?.length || 0;
    const words = normalized.split(' ');
    const singleLetterWords = words.filter(word => word.length === 1 && !/^[ai]$/.test(word)).length;
    const minimumConfidence = words.length === 1 ? 82 : words.length === 2 ? 70 : MIN_SCENE_OCR_CONFIDENCE;

    return confidence >= minimumConfidence
        && latinLetters >= 2
        && latinLetters / Math.max(1, letters) >= 0.7
        && expectedCharacters / Math.max(1, visibleCharacters) >= 0.75
        && singleLetterWords <= 1
        && !/(.)\1{3,}/i.test(normalized);
}
