import { CE } from "@/utils/html";
import type { NormalizedFrameRegion } from "@/utils/screenshot-manager";

export type TranslationOverlaySettings = {
    showOriginal: boolean;
    debugRegion: boolean;
    fontSize: number;
    verticalPosition: number;
    backgroundOpacity: number;
};

type DebugMetrics = Partial<{
    interval: number;
    changeScore: number;
    ocrTime: number;
    translationTime: number;
    ocrConfidence: number;
    candidates: number;
}>;

function getRenderedContentRect($player: HTMLVideoElement | HTMLCanvasElement) {
    const rect = $player.getBoundingClientRect();
    const sourceWidth = $player instanceof HTMLVideoElement ? $player.videoWidth : $player.width;
    const sourceHeight = $player instanceof HTMLVideoElement ? $player.videoHeight : $player.height;
    const objectFit = getComputedStyle($player).objectFit;

    if (!sourceWidth || !sourceHeight || objectFit !== 'contain') {
        return rect;
    }

    const scale = Math.min(rect.width / sourceWidth, rect.height / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    return new DOMRect(
        rect.left + (rect.width - width) / 2,
        rect.top + (rect.height - height) / 2,
        width,
        height,
    );
}

export class TranslationOverlay {
    private readonly $host: HTMLElement;
    private readonly $root: HTMLElement;
    private readonly $subtitle: HTMLElement;
    private readonly $translation: HTMLElement;
    private readonly $original: HTMLElement;
    private readonly $region: HTMLElement;
    private readonly $debug: HTMLElement;
    private settings: TranslationOverlaySettings;
    private originalText = '';

    constructor($video: HTMLVideoElement, settings: TranslationOverlaySettings) {
        this.settings = settings;
        this.$host = $video.closest<HTMLElement>('#game-stream') || $video.parentElement!;
        this.$root = CE('div', { class: 'bx-game-translator-overlay' },
            this.$subtitle = CE('div', { class: 'bx-game-translator-subtitle bx-gone' },
                this.$translation = CE('div', { class: 'bx-game-translator-translation' }),
                this.$original = CE('div', { class: 'bx-game-translator-original' }),
            ),
            this.$region = CE('div', { class: 'bx-game-translator-region bx-gone' }),
            this.$debug = CE('div', { class: 'bx-game-translator-debug bx-gone' }),
        );
        this.$subtitle.setAttribute('aria-live', 'polite');
        this.$host.appendChild(this.$root);
        this.applySettings(settings);
    }

    applySettings(settings: TranslationOverlaySettings) {
        this.settings = settings;
        this.$subtitle.style.fontSize = `${settings.fontSize}px`;
        this.$subtitle.style.backgroundColor = `rgba(0, 0, 0, ${settings.backgroundOpacity / 100})`;
        this.$original.classList.toggle('bx-gone', !settings.showOriginal || !this.originalText);
        this.$region.classList.toggle('bx-gone', !settings.debugRegion);
        this.$debug.classList.toggle('bx-gone', !settings.debugRegion);
    }

    updateGeometry($player: HTMLVideoElement | HTMLCanvasElement | null | undefined, region: NormalizedFrameRegion) {
        if (!$player || !$player.isConnected) {
            return;
        }

        const contentRect = getRenderedContentRect($player);
        if (!contentRect.width || !contentRect.height) {
            return;
        }

        this.$subtitle.style.left = `${contentRect.left + contentRect.width / 2}px`;
        this.$subtitle.style.bottom = `${window.innerHeight - contentRect.bottom + contentRect.height * this.settings.verticalPosition / 100}px`;
        this.$subtitle.style.maxWidth = `${contentRect.width * 0.9}px`;

        this.$region.style.left = `${contentRect.left + contentRect.width * region.x}px`;
        this.$region.style.top = `${contentRect.top + contentRect.height * region.y}px`;
        this.$region.style.width = `${contentRect.width * region.width}px`;
        this.$region.style.height = `${contentRect.height * region.height}px`;
    }

    show(originalText: string, translatedText: string) {
        this.originalText = originalText;
        this.$translation.textContent = translatedText;
        this.$original.textContent = originalText;
        this.$original.classList.toggle('bx-gone', !this.settings.showOriginal || !originalText);
        this.$subtitle.classList.toggle('bx-gone', !translatedText);
    }

    showError(message: string) {
        this.show('', message);
    }

    clear() {
        this.show('', '');
    }

    updateDebug(metrics: DebugMetrics) {
        const values = [];
        typeof metrics.interval === 'number' && values.push(`Interval: ${metrics.interval} ms`);
        typeof metrics.changeScore === 'number' && values.push(`Change: ${metrics.changeScore.toFixed(3)}`);
        typeof metrics.ocrTime === 'number' && values.push(`OCR: ${Math.round(metrics.ocrTime)} ms`);
        typeof metrics.ocrConfidence === 'number' && values.push(`Confidence: ${Math.round(metrics.ocrConfidence)}%`);
        typeof metrics.candidates === 'number' && values.push(`Lines: ${metrics.candidates}`);
        typeof metrics.translationTime === 'number' && values.push(`Translate: ${Math.round(metrics.translationTime)} ms`);
        this.$debug.textContent = values.join(' · ');
    }

    destroy() {
        this.$root.remove();
    }
}
