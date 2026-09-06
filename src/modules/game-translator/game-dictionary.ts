/** English source CRCs from Unreal localization; no approximate search over hashes. */
export function unrealSourceHash(text: string) {
    let crc = 0xffffffff;
    for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        // Unreal hashes UTF-16 code units padded to four bytes, including surrogates.
        for (const byte of [code & 255, code >>> 8, 0, 0]) {
            crc ^= byte;
            for (let bit = 0; bit < 8; bit++) {
                crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
            }
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

export function dictionaryCandidates(rawText: string) {
    const text = rawText.replace(/\s+/g, ' ').trim();
    if (!text || text.length > 500) {
        return [];
    }
    const candidates = new Set([text]);
    // Only a short name-shaped prefix, not arbitrary text before any colon.
    const withoutSpeaker = text.replace(/^[A-Za-z][A-Za-z '\u2019-]{0,39}:\s+/, '');
    candidates.add(withoutSpeaker);
    for (const candidate of [...candidates]) {
        const clean = candidate
            .replace(/[“”]/g, '"')
            .replace(/[‘’]/g, "'")
            .replace(/(^|[.!?:]\s+)\|\s+(?=[a-z])/g, '$1I ')
            .replace(/\s+([,.!?:;])/g, '$1');
        candidates.add(clean);
        candidates.add(clean.replace(/'/g, '’'));
        candidates.add(clean.replace(/\.\.\./g, '…'));
        candidates.add(clean.replace(/…/g, '...'));
        // Missing final punctuation is common, but do not change existing punctuation.
        if (/[A-Za-z]$/.test(clean)) {
            for (const ending of ['.', '?', '!', ':']) {
                candidates.add(clean + ending);
            }
        }
    }
    return [...candidates];
}

export class GameDictionary {
    private readonly translations = new Map<number, string>();

    constructor(payload: unknown, expectedId: string) {
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid dictionary');
        }
        const data = payload as Record<string, unknown>;
        if (data.schema !== 1 || data.id !== expectedId || data.sourceLanguage !== 'en' || data.targetLanguage !== 'ru'
            || !Array.isArray(data.strings) || !Array.isArray(data.entries)
            || !data.entries.length || data.entries.length > 100000 || data.strings.length > 100000) {
            throw new Error('Unsupported dictionary');
        }
        const strings = data.strings as unknown[];
        if (strings.some(text => typeof text !== 'string' || !text.trim() || text.length > 20000)) {
            throw new Error('Invalid dictionary text');
        }
        for (const entry of data.entries) {
            if (!Array.isArray(entry) || entry.length !== 2
                || !Number.isInteger(entry[0]) || entry[0] < 0 || entry[0] > 0xffffffff
                || !Number.isInteger(entry[1]) || entry[1] < 0 || entry[1] >= strings.length
                || this.translations.has(entry[0])) {
                throw new Error('Invalid or duplicate dictionary hash');
            }
            this.translations.set(entry[0], strings[entry[1]] as string);
        }
    }

    lookup(text: string): string {
        let result = '';
        for (const candidate of dictionaryCandidates(text)) {
            const translation = this.translations.get(unrealSourceHash(candidate));
            if (translation !== undefined) {
                // Multiple interpretations must agree. Never guess a dialogue branch.
                if (result && result !== translation) {
                    return '';
                }
                result = translation;
            }
        }
        return result;
    }
}
