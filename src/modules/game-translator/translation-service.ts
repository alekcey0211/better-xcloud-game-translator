import { GameTranslatorProvider } from "@/enums/pref-values";
import { NATIVE_FETCH } from "@/utils/bx-flags";

import { BrowserTranslationProvider } from "./browser-translation-provider";
import { DeepLContextTranslationProvider } from "./deepl-context-translation-provider";
import { normalizeText } from "./text-stabilizer";
import type { TranslationContext } from "./translation-context";

export interface TranslationProvider {
    translate(text: string, sourceLanguage: string, targetLanguage: string, signal: AbortSignal, context?: TranslationContext): Promise<string>;
    prepare?(sourceLanguage: string, targetLanguage: string, onDownloadProgress?: (progress: number) => void): Promise<unknown>;
    destroy?(): void;
}

type MyMemoryResponse = {
    responseStatus: number | string;
    responseData?: {
        translatedText?: string;
    };
};

export class MyMemoryTranslationProvider implements TranslationProvider {
    async translate(text: string, sourceLanguage: string, targetLanguage: string, signal: AbortSignal) {
        const params = new URLSearchParams({
            q: text,
            langpair: `${sourceLanguage}|${targetLanguage}`,
            mt: '1',
        });
        const response = await NATIVE_FETCH(`https://api.mymemory.translated.net/get?${params}`, { signal });
        if (!response.ok) {
            throw new Error(`Translation request failed with HTTP ${response.status}`);
        }

        const payload = await response.json() as MyMemoryResponse;
        const translatedText = payload.responseData?.translatedText?.trim();
        if (Number(payload.responseStatus) !== 200 || !translatedText) {
            throw new Error(`Translation provider returned status ${payload.responseStatus}`);
        }

        const decoder = document.createElement('textarea');
        decoder.innerHTML = translatedText;
        return decoder.value;
    }
}

export type TranslationResult = {
    text: string;
    cacheHit: boolean;
    latency: number;
};

export class TranslationService {
    private readonly cache = new Map<string, string>();
    private readonly providers: Record<GameTranslatorProvider, TranslationProvider>;

    constructor(getDeepLProxyUrl: () => string) {
        this.providers = {
            [GameTranslatorProvider.BROWSER]: new BrowserTranslationProvider(),
            [GameTranslatorProvider.DEEPL_CONTEXT]: new DeepLContextTranslationProvider(getDeepLProxyUrl, NATIVE_FETCH),
            [GameTranslatorProvider.MY_MEMORY]: new MyMemoryTranslationProvider(),
        };
    }

    async prepare(providerId: GameTranslatorProvider, onDownloadProgress?: (progress: number) => void) {
        await this.providers[providerId].prepare?.('en', 'ru', onDownloadProgress);
    }

    async translate(providerId: GameTranslatorProvider, text: string, signal: AbortSignal, context?: TranslationContext): Promise<TranslationResult> {
        const contextKey = providerId === GameTranslatorProvider.DEEPL_CONTEXT ? normalizeText(context?.gameTitle || '') : '';
        const cacheKey = `${providerId}:${contextKey}:${normalizeText(text)}`;
        const cached = this.cache.get(cacheKey);
        if (cached) {
            return { text: cached, cacheHit: true, latency: 0 };
        }

        const startedAt = performance.now();
        const translated = await this.providers[providerId].translate(text, 'en', 'ru', signal, context);
        const latency = performance.now() - startedAt;
        this.cache.set(cacheKey, translated);

        return { text: translated, cacheHit: false, latency };
    }

    clear() {
        this.cache.clear();
    }

    destroy() {
        this.clear();
        Object.values(this.providers).forEach(provider => provider.destroy?.());
    }
}
