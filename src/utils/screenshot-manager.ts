import { AppInterface, STATES } from "./global";
import { CE } from "./html";
import { GlobalPref } from "@/enums/pref-keys";
import { BxLogger } from "./bx-logger";
import { getGlobalPref } from "@/utils/pref-utils";
import { StreamPlayerElement } from "@/modules/player/base-stream-player";

export type NormalizedFrameRegion = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type CaptureFrameOptions = {
    elementType?: StreamPlayerElement;
    region?: NormalizedFrameRegion;
};

export class ScreenshotManager {
    private static instance: ScreenshotManager;
    public static getInstance = () => ScreenshotManager.instance ?? (ScreenshotManager.instance = new ScreenshotManager());
    private readonly LOG_TAG = 'ScreenshotManager';

    private $download: HTMLAnchorElement;
    private $canvas: HTMLCanvasElement;
    private canvasContext: CanvasRenderingContext2D;

    private constructor() {
        BxLogger.info(this.LOG_TAG, 'constructor()');

        this.$download = CE('a');

        this.$canvas = CE('canvas', { class: 'bx-gone' });
        this.canvasContext = this.$canvas.getContext('2d', {
            alpha: false,
            willReadFrequently: false,
        })!;
    }

    updateCanvasSize(width: number, height: number) {
        this.$canvas.width = width;
        this.$canvas.height = height;
    }

    updateCanvasFilters(filters: string) {
        this.canvasContext.filter = filters;
    }

    private onAnimationEnd(e: Event) {
        (e.target as HTMLElement).classList.remove('bx-taking-screenshot');
    }

    getCurrentFrameSource(elementType?: StreamPlayerElement) {
        return STATES.currentStream.streamPlayerManager?.getPlayerElement(elementType);
    }

    captureFrame($target: HTMLCanvasElement, options: CaptureFrameOptions = {}) {
        const streamPlayerManager = STATES.currentStream.streamPlayerManager;
        const $player = this.getCurrentFrameSource(options.elementType);
        if (!streamPlayerManager || !$player || !$player.isConnected) {
            return false;
        }

        if ($player instanceof HTMLCanvasElement) {
            streamPlayerManager.getCanvasPlayer()?.updateFrame();
        }

        const sourceWidth = $player instanceof HTMLVideoElement ? $player.videoWidth : $player.width;
        const sourceHeight = $player instanceof HTMLVideoElement ? $player.videoHeight : $player.height;
        if (!sourceWidth || !sourceHeight || !$target.width || !$target.height) {
            return false;
        }

        const region = options.region || { x: 0, y: 0, width: 1, height: 1 };
        const context = $target === this.$canvas
            ? this.canvasContext
            : $target.getContext('2d', { alpha: false, willReadFrequently: true });
        if (!context) {
            return false;
        }

        context.drawImage(
            $player,
            Math.round(region.x * sourceWidth),
            Math.round(region.y * sourceHeight),
            Math.round(region.width * sourceWidth),
            Math.round(region.height * sourceHeight),
            0,
            0,
            $target.width,
            $target.height,
        );

        return true;
    }

    takeScreenshot(callback?: any) {
        const currentStream = STATES.currentStream;
        const $canvas = this.$canvas;
        let elementType;
        if (getGlobalPref(GlobalPref.SCREENSHOT_APPLY_FILTERS)) {
            elementType = undefined;
        } else {
            elementType = StreamPlayerElement.VIDEO;
        }

        if (!this.captureFrame($canvas, { elementType })) {
            return;
        }

        const $player = this.getCurrentFrameSource(elementType)!;
        const canvasContext = this.canvasContext;

        // Play animation
        const $gameStream = $player.closest('#game-stream');
        if ($gameStream) {
            $gameStream.addEventListener('animationend', this.onAnimationEnd, { once: true });
            $gameStream.classList.add('bx-taking-screenshot');
        }

        // Get data URL and pass to parent app
        if (AppInterface) {
            const data = $canvas.toDataURL('image/png').split(';base64,')[1];
            AppInterface.saveScreenshot(currentStream.titleSlug, data);

            // Free screenshot from memory
            canvasContext.clearRect(0, 0, $canvas.width, $canvas.height);

            callback && callback();
            return;
        }

        $canvas.toBlob(blob => {
            if (!blob) {
                return;
            }

            // Download screenshot
            const now = +new Date;
            const $download = this.$download;
            $download.download = `${currentStream.titleSlug}-${now}.png`;
            $download.href = URL.createObjectURL(blob);
            $download.click();

            // Free screenshot from memory
            URL.revokeObjectURL($download.href);
            $download.href = '';
            $download.download = '';
            canvasContext.clearRect(0, 0, $canvas.width, $canvas.height);

            callback && callback();
        }, 'image/png');
    }
}
