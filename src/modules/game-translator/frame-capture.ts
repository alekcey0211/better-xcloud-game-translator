import { GameTranslatorOcrRegion } from "@/enums/pref-values";
import { StreamPlayerElement } from "@/modules/player/base-stream-player";
import { ScreenshotManager, type NormalizedFrameRegion } from "@/utils/screenshot-manager";

import { createOcrLayout } from "./ocr-layout";
import type { SubtitleLine } from "./subtitle-detector";

const DETECTION_WIDTH = 640;
const MAX_OCR_WIDTH = 1280;

const OCR_REGIONS: Record<GameTranslatorOcrRegion, NormalizedFrameRegion> = {
    [GameTranslatorOcrRegion.TOP]: { x: 0.05, y: 0.03, width: 0.9, height: 0.35 },
    [GameTranslatorOcrRegion.CENTER]: { x: 0.05, y: 0.325, width: 0.9, height: 0.35 },
    [GameTranslatorOcrRegion.BOTTOM]: { x: 0.05, y: 0.62, width: 0.9, height: 0.35 },
};

export class TranslatorFrameCapture {
    private readonly screenshotManager = ScreenshotManager.getInstance();
    private readonly $detectionCanvas = document.createElement('canvas');
    private readonly $ocrSourceCanvas = document.createElement('canvas');
    private readonly $ocrCanvas = document.createElement('canvas');
    private readonly detectionContext: CanvasRenderingContext2D;
    private region: NormalizedFrameRegion;

    constructor(region: GameTranslatorOcrRegion) {
        this.region = OCR_REGIONS[region];

        this.$detectionCanvas.width = DETECTION_WIDTH;
        this.$detectionCanvas.height = 1;
        this.detectionContext = this.$detectionCanvas.getContext('2d', {
            alpha: false,
            willReadFrequently: true,
        })!;
    }

    setRegion(region: GameTranslatorOcrRegion) {
        this.region = OCR_REGIONS[region];
    }

    getRegion() {
        return this.region;
    }

    getDisplayElement() {
        return this.screenshotManager.getCurrentFrameSource();
    }

    captureForDetection() {
        const $video = this.screenshotManager.getCurrentFrameSource(StreamPlayerElement.VIDEO);
        if (!($video instanceof HTMLVideoElement) || !$video.videoWidth || !$video.videoHeight) {
            return null;
        }

        const targetHeight = Math.max(1, Math.round(
            DETECTION_WIDTH * ($video.videoHeight * this.region.height) / ($video.videoWidth * this.region.width),
        ));
        if (this.$detectionCanvas.height !== targetHeight) {
            this.$detectionCanvas.height = targetHeight;
        }

        const captured = this.screenshotManager.captureFrame(this.$detectionCanvas, {
            elementType: StreamPlayerElement.VIDEO,
            region: this.region,
        });

        if (!captured) {
            return null;
        }

        return this.detectionContext.getImageData(0, 0, this.$detectionCanvas.width, this.$detectionCanvas.height);
    }

    captureForOcr(lines: SubtitleLine[]) {
        const $video = this.screenshotManager.getCurrentFrameSource(StreamPlayerElement.VIDEO);
        if (!($video instanceof HTMLVideoElement) || !$video.videoWidth || !$video.videoHeight) {
            return null;
        }

        const targetWidth = MAX_OCR_WIDTH;
        const targetHeight = Math.max(1, Math.round(
            targetWidth * ($video.videoHeight * this.region.height) / ($video.videoWidth * this.region.width),
        ));
        if (this.$ocrSourceCanvas.width !== targetWidth || this.$ocrSourceCanvas.height !== targetHeight) {
            this.$ocrSourceCanvas.width = targetWidth;
            this.$ocrSourceCanvas.height = targetHeight;
        }

        const captured = this.screenshotManager.captureFrame(this.$ocrSourceCanvas, {
            elementType: StreamPlayerElement.VIDEO,
            region: this.region,
        });
        if (!captured) {
            return null;
        }

        const layout = createOcrLayout(lines, targetWidth, targetHeight);
        if (this.$ocrCanvas.width !== layout.width || this.$ocrCanvas.height !== layout.height) {
            this.$ocrCanvas.width = layout.width;
            this.$ocrCanvas.height = layout.height;
        }

        const context = this.$ocrCanvas.getContext('2d', { alpha: false })!;
        context.fillStyle = '#000';
        context.fillRect(0, 0, layout.width, layout.height);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.filter = 'grayscale(1) contrast(1.8)';
        for (const line of layout.lines) {
            context.drawImage(
                this.$ocrSourceCanvas,
                line.sourceX,
                line.sourceY,
                line.sourceWidth,
                line.sourceHeight,
                line.targetX,
                line.targetY,
                line.targetWidth,
                line.targetHeight,
            );
        }

        return this.$ocrCanvas;
    }

    destroy() {
        this.$detectionCanvas.width = 1;
        this.$detectionCanvas.height = 1;
        this.$ocrSourceCanvas.width = 1;
        this.$ocrSourceCanvas.height = 1;
        this.$ocrCanvas.width = 1;
        this.$ocrCanvas.height = 1;
    }
}
