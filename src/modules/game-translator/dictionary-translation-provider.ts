import { GAME_DICTIONARIES } from "./dictionary-catalog.ts";
import { GameDictionary } from "./game-dictionary.ts";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Downloads a static game pack only. Never sends OCR text or calls a translator. */
export class DictionaryTranslationProvider {
    private load: {
        id: string;
        controller: AbortController;
        promise: Promise<GameDictionary>;
        retryAt: number;
    } | null = null;

    private readonly getDictionaryId: () => string;
    private readonly fetcher: Fetcher;

    constructor(getDictionaryId: () => string, fetcher: Fetcher) {
        this.getDictionaryId = getDictionaryId;
        this.fetcher = fetcher;
    }

    prepare() {
        const id = this.getDictionaryId();
        if (this.load?.id === id && Date.now() < this.load.retryAt) {
            return this.load.promise;
        }
        this.destroy();
        const descriptor = Object.hasOwn(GAME_DICTIONARIES, id)
            ? GAME_DICTIONARIES[id as keyof typeof GAME_DICTIONARIES] : undefined;
        if (!descriptor) {
            return Promise.reject(new Error('Select a game dictionary'));
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        const load = {
            id,
            controller,
            retryAt: Infinity,
            promise: this.fetcher(descriptor.url, {
                signal: controller.signal,
                credentials: 'omit',
                cache: 'force-cache',
            }).then(async response => {
                if (!response.ok) {
                    throw new Error(`Dictionary download failed: HTTP ${response.status}`);
                }
                const json = await response.text();
                if (json.length > 8000000) {
                    throw new Error('Dictionary is too large');
                }
                const dictionary = new GameDictionary(JSON.parse(json), id);
                if (controller.signal.aborted) {
                    throw new DOMException('Dictionary download cancelled', 'AbortError');
                }
                return dictionary;
            }).catch(error => {
                // Avoid a new download for every OCR frame when the server is down.
                load.retryAt = Date.now() + 30000;
                throw error;
            }).finally(() => clearTimeout(timeout)),
        };
        this.load = load;
        return load.promise;
    }

    async translate(text: string, sourceLanguage: string, targetLanguage: string, signal: AbortSignal) {
        if (signal.aborted) {
            throw new DOMException('Translation cancelled', 'AbortError');
        }
        if (sourceLanguage !== 'en' || targetLanguage !== 'ru') {
            return '';
        }
        const dictionary = await this.prepare();
        if (signal.aborted) {
            throw new DOMException('Translation cancelled', 'AbortError');
        }
        return dictionary.lookup(text);
    }

    destroy() {
        this.load?.controller.abort();
        this.load = null;
    }
}
