import { normalizeText } from "./text-stabilizer.ts";

export const MIN_SUBTITLE_OCR_CONFIDENCE = 45;

const UI_TEXT_PATTERNS = [
    /^(?:press|hold|tap|release)\s+(?:[a-z0-9]|button|key|to)\b/i,
    /^(?:new\s+)?(?:objective|mission|quest)\s+(?:updated|complete|completed|failed)\b/i,
    /^(?:checkpoint\s+(?:reached|saved)|auto-?saving|saving|loading)\b/i,
    /^(?:ammo|armor|health|score|inventory|settings|options|map)\b/i,
    /\bhttps?:\/\//i,
];

/**
 * Rejects common HUD labels and button prompts after OCR. Geometry alone can
 * distinguish corner UI, but centered prompts often look exactly like subtitles.
 */
export function isLikelySubtitleText(rawText: string) {
    const text = rawText.replace(/\s+/g, ' ').trim();
    const normalized = normalizeText(text);
    if (!normalized || normalized.length > 240 || UI_TEXT_PATTERNS.some(pattern => pattern.test(text))) {
        return false;
    }

    const letters = text.match(/\p{L}/gu)?.length || 0;
    const digits = text.match(/\p{N}/gu)?.length || 0;
    if (letters < 2 || digits > Math.max(2, Math.floor(letters / 4))) {
        return false;
    }

    const words = normalized.split(' ');
    const hasDialoguePunctuation = /[.!?…,:;–—-]["')\]]?$/.test(text);

    // Short unpunctuated labels are much more likely to be HUD/menu text than
    // dialogue. One-word dialogue such as "What?" still passes.
    return words.length >= 3 || hasDialoguePunctuation;
}
