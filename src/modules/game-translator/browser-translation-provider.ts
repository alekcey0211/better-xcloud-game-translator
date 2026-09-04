type TranslatorAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

type TranslatorCreateOptions = {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (monitor: EventTarget) => void;
};

type BrowserTranslator = {
    translate(text: string, options?: { signal?: AbortSignal }): Promise<string>;
    destroy(): void;
};

type BrowserTranslatorFactory = {
    availability(options: Pick<TranslatorCreateOptions, 'sourceLanguage' | 'targetLanguage'>): Promise<TranslatorAvailability>;
    create(options: TranslatorCreateOptions): Promise<BrowserTranslator>;
};

type BrowserTranslatorWindow = Window & {
    Translator?: BrowserTranslatorFactory;
};

export type BrowserTranslatorPreparation = {
    availability: Exclude<TranslatorAvailability, 'unavailable'>;
    created: boolean;
};

export class BrowserTranslationProvider {
    private translatorPromise: Promise<BrowserTranslator> | null = null;

    async prepare(
        sourceLanguage: string,
        targetLanguage: string,
        onDownloadProgress?: (progress: number) => void,
    ): Promise<BrowserTranslatorPreparation> {
        const factory = (window as BrowserTranslatorWindow).Translator;
        if (!factory) {
            throw new Error('Browser Translator API is unavailable');
        }

        if (this.translatorPromise) {
            await this.translatorPromise;
            return { availability: 'available', created: false };
        }

        const options = { sourceLanguage, targetLanguage };
        const availability = await factory.availability(options);
        if (availability === 'unavailable') {
            throw new Error(`Browser Translator does not support ${sourceLanguage} → ${targetLanguage}`);
        }

        const translatorPromise = factory.create({
            ...options,
            monitor: monitor => {
                monitor.addEventListener('downloadprogress', event => {
                    const progress = 'loaded' in event ? Number(event.loaded) : 0;
                    onDownloadProgress?.(Math.max(0, Math.min(1, progress)));
                });
            },
        });
        this.translatorPromise = translatorPromise;

        try {
            await translatorPromise;
        } catch (error) {
            if (this.translatorPromise === translatorPromise) {
                this.translatorPromise = null;
            }
            throw error;
        }

        return { availability, created: true };
    }

    async translate(text: string, sourceLanguage: string, targetLanguage: string, signal: AbortSignal) {
        await this.prepare(sourceLanguage, targetLanguage);
        const translator = await this.translatorPromise!;
        const translated = (await translator.translate(text, { signal })).trim();
        if (!translated) {
            throw new Error('Browser Translator returned an empty translation');
        }

        return translated;
    }

    destroy() {
        const translatorPromise = this.translatorPromise;
        this.translatorPromise = null;
        translatorPromise?.then(translator => translator.destroy()).catch(() => {});
    }
}
