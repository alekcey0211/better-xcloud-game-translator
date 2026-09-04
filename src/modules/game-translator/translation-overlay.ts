import { CE } from "@/utils/html";
import type { NormalizedFrameRegion } from "@/utils/screenshot-manager";

import { getTranslationDisplayDuration } from "./translation-retention";

export type TranslationOverlaySettings = {
    showOriginal: boolean;
    debugRegion: boolean;
    fontSize: number;
    verticalPosition: number;
    backgroundOpacity: number;
    minimumDisplayTime: number;
};

type DebugMetrics = Partial<{
    interval: number;
    changeScore: number;
    ocrTime: number;
    translationTime: number;
    ocrConfidence: number;
    candidates: number;
}>;

export type TranslatedSceneText = {
    originalText: string;
    translatedText: string;
    box: NormalizedFrameRegion;
};

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
    private readonly $scene: HTMLElement;
    private readonly $region: HTMLElement;
    private readonly $debug: HTMLElement;
    private settings: TranslationOverlaySettings;
    private originalText = '';
    private clearTimerId: number | null = null;
    private visibleUntil = 0;
    private sceneItems: TranslatedSceneText[] = [];
    private contentRect: DOMRect | null = null;
    private sceneClearTimerId: number | null = null;

    constructor($video: HTMLVideoElement, settings: TranslationOverlaySettings) {
        this.settings = settings;
        this.$host = $video.closest<HTMLElement>('#game-stream') || $video.parentElement!;
        this.$root = CE('div', { class: 'bx-game-translator-overlay' },
            this.$subtitle = CE('div', { class: 'bx-game-translator-subtitle bx-gone' },
                this.$translation = CE('div', { class: 'bx-game-translator-translation' }),
                this.$original = CE('div', { class: 'bx-game-translator-original' }),
            ),
            this.$scene = CE('div', { class: 'bx-game-translator-scene bx-gone' }),
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
        this.renderSceneItems();
    }

    updateGeometry($player: HTMLVideoElement | HTMLCanvasElement | null | undefined, region: NormalizedFrameRegion) {
        if (!$player || !$player.isConnected) {
            return;
        }

        const contentRect = getRenderedContentRect($player);
        if (!contentRect.width || !contentRect.height) {
            return;
        }
        this.contentRect = contentRect;

        this.$subtitle.style.left = `${contentRect.left + contentRect.width / 2}px`;
        this.$subtitle.style.bottom = `${window.innerHeight - contentRect.bottom + contentRect.height * this.settings.verticalPosition / 100}px`;
        this.$subtitle.style.maxWidth = `${contentRect.width * 0.9}px`;

        this.$region.style.left = `${contentRect.left + contentRect.width * region.x}px`;
        this.$region.style.top = `${contentRect.top + contentRect.height * region.y}px`;
        this.$region.style.width = `${contentRect.width * region.width}px`;
        this.$region.style.height = `${contentRect.height * region.height}px`;
        this.renderSceneItems();
    }

    show(originalText: string, translatedText: string) {
        this.clearSceneImmediately();
        this.cancelClear();
        this.originalText = originalText;
        this.$translation.textContent = translatedText;
        this.$original.textContent = originalText;
        this.$original.classList.toggle('bx-gone', !this.settings.showOriginal || !originalText);
        this.$subtitle.classList.toggle('bx-gone', !translatedText);
        this.visibleUntil = translatedText
            ? performance.now() + getTranslationDisplayDuration(translatedText, this.settings.minimumDisplayTime)
            : 0;
    }

    showError(message: string) {
        this.show('', message);
    }

    showScene(items: TranslatedSceneText[]) {
        this.cancelClear();
        this.cancelSceneClear();
        this.hide();
        this.sceneItems = items;
        this.renderSceneItems();
        this.$scene.classList.toggle('bx-gone', !items.length);
    }

    clearScene() {
        if (!this.sceneItems.length || this.sceneClearTimerId !== null) {
            return;
        }

        this.sceneClearTimerId = window.setTimeout(() => {
            this.sceneClearTimerId = null;
            this.clearSceneImmediately();
        }, this.settings.minimumDisplayTime);
    }

    resetContent() {
        this.cancelClear();
        this.cancelSceneClear();
        this.hide();
        this.clearSceneImmediately();
    }

    clear() {
        if (this.clearTimerId !== null) {
            return;
        }

        const remainingTime = this.visibleUntil - performance.now();
        if (remainingTime <= 0) {
            this.hide();
            return;
        }

        this.clearTimerId = window.setTimeout(() => {
            this.clearTimerId = null;
            this.hide();
        }, remainingTime);
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
        this.cancelClear();
        this.cancelSceneClear();
        this.$root.remove();
    }

    private hide() {
        this.originalText = '';
        this.visibleUntil = 0;
        this.$translation.textContent = '';
        this.$original.textContent = '';
        this.$original.classList.add('bx-gone');
        this.$subtitle.classList.add('bx-gone');
    }

    private cancelClear() {
        if (this.clearTimerId !== null) {
            window.clearTimeout(this.clearTimerId);
            this.clearTimerId = null;
        }
    }

    private renderSceneItems() {
        const contentRect = this.contentRect;
        if (!contentRect || !this.sceneItems.length) {
            return;
        }

        const elements = this.sceneItems.map(item => {
            const height = Math.max(18, item.box.height * contentRect.height);
            const $item = CE('div', { class: 'bx-game-translator-scene-text' },
                CE('div', { class: 'bx-game-translator-translation' }, item.translatedText),
                CE('div', {
                    class: `bx-game-translator-original${this.settings.showOriginal ? '' : ' bx-gone'}`,
                }, item.originalText),
            );
            $item.style.left = `${contentRect.left + item.box.x * contentRect.width}px`;
            $item.style.top = `${contentRect.top + item.box.y * contentRect.height}px`;
            $item.style.width = `${Math.max(64, item.box.width * contentRect.width)}px`;
            $item.style.minHeight = `${height}px`;
            $item.style.fontSize = `${Math.max(12, Math.min(this.settings.fontSize, height * 0.72))}px`;
            $item.style.backgroundColor = `rgba(0, 0, 0, ${this.settings.backgroundOpacity / 100})`;

            return $item;
        });

        this.$scene.replaceChildren(...elements);
    }

    private clearSceneImmediately() {
        this.cancelSceneClear();
        this.sceneItems = [];
        this.$scene.replaceChildren();
        this.$scene.classList.add('bx-gone');
    }

    private cancelSceneClear() {
        if (this.sceneClearTimerId !== null) {
            window.clearTimeout(this.sceneClearTimerId);
            this.sceneClearTimerId = null;
        }
    }
}
