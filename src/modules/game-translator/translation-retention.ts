const READING_TIME_PER_CHARACTER = 65;
const MAX_AUTOMATIC_DISPLAY_TIME = 12_000;

export function getTranslationDisplayDuration(text: string, minimumDisplayTime: number) {
    const readableCharacters = text.replace(/\s+/g, ' ').trim().length;
    const readingTime = Math.min(MAX_AUTOMATIC_DISPLAY_TIME, readableCharacters * READING_TIME_PER_CHARACTER);

    return Math.max(minimumDisplayTime, readingTime);
}
