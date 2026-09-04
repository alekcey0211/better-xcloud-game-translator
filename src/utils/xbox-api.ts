import { NATIVE_FETCH } from "./bx-flags"

export type XboxProductContext = {
    title: string;
    description: string;
};

export class XboxApi {
    private static CACHED_TITLES: Record<string, string> = {};
    private static CACHED_PRODUCT_CONTEXTS: Record<string, XboxProductContext> = {};

    static async getProductTitle(xboxTitleId: number | string): Promise<string | undefined> {
        xboxTitleId = xboxTitleId.toString();
        if (XboxApi.CACHED_TITLES[xboxTitleId]) {
            return XboxApi.CACHED_TITLES[xboxTitleId];
        }

        let title: string;
        try {
            const url = `https://displaycatalog.mp.microsoft.com/v7.0/products/lookup?market=US&languages=en&value=${xboxTitleId}&alternateId=XboxTitleId&fieldsTemplate=browse`;
            const resp = await NATIVE_FETCH(url);
            const json = await resp.json();

            title = json['Products'][0]['LocalizedProperties'][0]['ProductTitle'];
        } catch (e) {
            title = 'Unknown Game #' + xboxTitleId;
        }

        XboxApi.CACHED_TITLES[xboxTitleId] = title;
        return title;
    }

    static async getProductContext(productId: string): Promise<XboxProductContext | undefined> {
        if (XboxApi.CACHED_PRODUCT_CONTEXTS[productId]) {
            return XboxApi.CACHED_PRODUCT_CONTEXTS[productId];
        }

        try {
            const params = new URLSearchParams({
                bigIds: productId,
                market: 'US',
                languages: 'en-US',
                'MS-CV': 'better-xcloud.game-translator',
            });
            const response = await NATIVE_FETCH(`https://displaycatalog.mp.microsoft.com/v7.0/products?${params}`);
            if (!response.ok) {
                return;
            }

            const json = await response.json();
            const localized = json['Products']?.[0]?.['LocalizedProperties']?.[0];
            if (!localized) {
                return;
            }

            const context = {
                title: String(localized['ProductTitle'] || '').trim(),
                description: String(localized['ShortDescription'] || localized['ProductDescription'] || '').trim(),
            };
            XboxApi.CACHED_PRODUCT_CONTEXTS[productId] = context;
            return context;
        } catch {
            return;
        }
    }
}
