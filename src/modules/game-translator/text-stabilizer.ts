function normalizeDisplayText(text: string) {
    return text
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/(^|[.!?]\s+)\|\s+(?=[a-z])/gi, '$1I ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function normalizeText(text: string) {
    return normalizeDisplayText(text)
        .toLocaleLowerCase('en-US')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function levenshteinDistance(left: string, right: string) {
    if (!left.length) {
        return right.length;
    }
    if (!right.length) {
        return left.length;
    }

    let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
        const current = [leftIndex];
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
            const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
            current[rightIndex] = Math.min(
                current[rightIndex - 1] + 1,
                previous[rightIndex] + 1,
                previous[rightIndex - 1] + substitutionCost,
            );
        }
        previous = current;
    }

    return previous[right.length];
}

function similarity(left: string, right: string) {
    const maxLength = Math.max(left.length, right.length);
    return maxLength === 0 ? 1 : 1 - levenshteinDistance(left, right) / maxLength;
}

export function looksLikeCompleteSubtitle(text: string) {
    return /[.!?…–—-]["')\]]?$/.test(text.trim());
}

export class TextStabilizer {
    private delay: number;
    private readonly onStable: (text: string) => void;
    private timeoutId: ReturnType<typeof setTimeout> | null = null;
    private candidate = '';
    private candidateKey = '';
    private lastEmittedKey = '';
    private candidateStartedAt = 0;

    constructor(delay: number, onStable: (text: string) => void) {
        this.delay = delay;
        this.onStable = onStable;
    }

    setDelay(delay: number) {
        this.delay = delay;
    }

    push(rawText: string, quick = false) {
        const text = normalizeDisplayText(rawText);
        const key = normalizeText(text);
        const containsEnoughText = (key.match(/[a-z]/g) || []).length >= 2 && key.length <= 400;
        const nextText = containsEnoughText ? text : '';
        const nextKey = containsEnoughText ? key : '';

        if (nextKey === this.lastEmittedKey || (nextKey && similarity(nextKey, this.lastEmittedKey) >= 0.92)) {
            return;
        }

        if (nextKey === this.candidateKey) {
            if (quick) {
                this.schedule(Math.min(this.delay, 120));
            }
            return;
        }

        if (nextKey && this.candidateKey && similarity(nextKey, this.candidateKey) >= 0.88) {
            this.candidate = nextText;
            this.candidateKey = nextKey;
            if (quick) {
                this.schedule(Math.min(this.delay, 120));
            }
            return;
        }

        this.candidate = nextText;
        this.candidateKey = nextKey;
        this.candidateStartedAt = performance.now();
        this.schedule(quick ? Math.min(this.delay, 120) : this.delay);
    }

    private schedule(delay: number) {
        const elapsed = performance.now() - this.candidateStartedAt;
        const remainingDelay = Math.max(0, delay - elapsed);
        this.timeoutId && clearTimeout(this.timeoutId);
        this.timeoutId = setTimeout(() => {
            this.timeoutId = null;
            this.lastEmittedKey = this.candidateKey;
            this.onStable(this.candidate);
        }, remainingDelay);
    }

    reset() {
        this.timeoutId && clearTimeout(this.timeoutId);
        this.timeoutId = null;
        this.candidate = '';
        this.candidateKey = '';
        this.lastEmittedKey = '';
        this.candidateStartedAt = 0;
    }
}
