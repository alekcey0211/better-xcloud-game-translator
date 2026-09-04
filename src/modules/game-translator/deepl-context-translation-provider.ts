import { buildDeepLContext, type TranslationContext } from "./translation-context.ts";

type DeepLResponse = {
    message?: string;
    translations?: Array<{
        text?: string;
    }>;
};

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class DeepLContextTranslationProvider {
    private readonly getProxyUrl: () => string;
    private readonly fetcher: Fetcher;

    constructor(
        getProxyUrl: () => string,
        fetcher: Fetcher,
    ) {
        this.getProxyUrl = getProxyUrl;
        this.fetcher = fetcher;
    }

    async prepare() {
        this.getValidatedProxyUrl();
    }

    async translate(
        text: string,
        sourceLanguage: string,
        targetLanguage: string,
        signal: AbortSignal,
        context?: TranslationContext,
    ) {
        const deeplContext = buildDeepLContext(context);
        const body: Record<string, string | string[]> = {
            text: [text],
            source_lang: sourceLanguage.toUpperCase(),
            target_lang: targetLanguage.toUpperCase(),
        };
        if (deeplContext) {
            body.context = deeplContext;
        }

        const response = await this.fetcher(this.getValidatedProxyUrl(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal,
        });
        const payload = await response.json() as DeepLResponse;
        const translatedText = payload.translations?.[0]?.text?.trim();
        if (!response.ok || !translatedText) {
            throw new Error(payload.message || `DeepL proxy returned HTTP ${response.status}`);
        }

        return translatedText;
    }

    private getValidatedProxyUrl() {
        const proxyUrl = this.getProxyUrl().trim();
        if (!proxyUrl) {
            throw new Error('DeepL proxy URL is not configured');
        }

        let url: URL;
        try {
            url = new URL(proxyUrl);
        } catch {
            throw new Error('DeepL proxy URL is invalid');
        }
        if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
            throw new Error('DeepL proxy URL must use HTTPS');
        }

        return url.toString();
    }
}
