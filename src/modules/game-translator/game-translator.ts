import { GlobalPref } from "@/enums/pref-keys";
import { GameTranslatorMode, GameTranslatorOcrRegion, GameTranslatorProvider } from "@/enums/pref-values";
import { StreamPlayerElement } from "@/modules/player/base-stream-player";
import { BxEventBus } from "@/utils/bx-event-bus";
import { BxLogger } from "@/utils/bx-logger";
import { STATES } from "@/utils/global";
import { getGlobalPref } from "@/utils/pref-utils";
import { ScreenshotManager } from "@/utils/screenshot-manager";
import { Toast } from "@/utils/toast";
import { XboxApi } from "@/utils/xbox-api";

import { FrameChangeDetector } from "./frame-change-detector";
import { TranslatorFrameCapture } from "./frame-capture";
import { TesseractOcrEngine, type SceneOcrLine } from "./ocr-engine";
import { createSceneSignature, isLikelyEnglishSceneText, MIN_SCENE_OCR_CONFIDENCE } from "./scene-text";
import { SceneTextTracker } from "./scene-text-tracker";
import { SubtitleDetector } from "./subtitle-detector";
import { isLikelySubtitleText, MIN_SUBTITLE_OCR_CONFIDENCE } from "./subtitle-text-filter";
import { SubtitleTracker } from "./subtitle-tracker";
import { looksLikeCompleteSubtitle, normalizeText, TextStabilizer } from "./text-stabilizer";
import { GameTranslationContext } from "./translation-context";
import { TranslationOverlay, type TranslatedSceneText, type TranslationOverlaySettings } from "./translation-overlay";
import { TranslationService } from "./translation-service";

type GameTranslatorSettings = TranslationOverlaySettings & {
    enabled: boolean;
    mode: GameTranslatorMode;
    ocrRegion: GameTranslatorOcrRegion;
    ocrInterval: number;
    changeThreshold: number;
    stabilizationInterval: number;
    provider: GameTranslatorProvider;
};

const TRANSLATOR_PREFS = new Set<GlobalPref>([
    GlobalPref.GAME_TRANSLATOR_ENABLED,
    GlobalPref.GAME_TRANSLATOR_MODE,
    GlobalPref.GAME_TRANSLATOR_OCR_REGION,
    GlobalPref.GAME_TRANSLATOR_OCR_INTERVAL,
    GlobalPref.GAME_TRANSLATOR_CHANGE_THRESHOLD,
    GlobalPref.GAME_TRANSLATOR_STABILIZATION_INTERVAL,
    GlobalPref.GAME_TRANSLATOR_MIN_DISPLAY_TIME,
    GlobalPref.GAME_TRANSLATOR_PROVIDER,
    GlobalPref.GAME_TRANSLATOR_DEEPL_PROXY_URL,
    GlobalPref.GAME_TRANSLATOR_SHOW_ORIGINAL,
    GlobalPref.GAME_TRANSLATOR_DEBUG_REGION,
    GlobalPref.GAME_TRANSLATOR_FONT_SIZE,
    GlobalPref.GAME_TRANSLATOR_VERTICAL_POSITION,
    GlobalPref.GAME_TRANSLATOR_BACKGROUND_OPACITY,
]);

function readSettings(): GameTranslatorSettings {
    return {
        enabled: getGlobalPref(GlobalPref.GAME_TRANSLATOR_ENABLED),
        mode: getGlobalPref(GlobalPref.GAME_TRANSLATOR_MODE),
        ocrRegion: getGlobalPref(GlobalPref.GAME_TRANSLATOR_OCR_REGION),
        ocrInterval: Number(getGlobalPref(GlobalPref.GAME_TRANSLATOR_OCR_INTERVAL)),
        changeThreshold: getGlobalPref(GlobalPref.GAME_TRANSLATOR_CHANGE_THRESHOLD) / 100,
        stabilizationInterval: Number(getGlobalPref(GlobalPref.GAME_TRANSLATOR_STABILIZATION_INTERVAL)),
        provider: getGlobalPref(GlobalPref.GAME_TRANSLATOR_PROVIDER),
        showOriginal: getGlobalPref(GlobalPref.GAME_TRANSLATOR_SHOW_ORIGINAL),
        debugRegion: getGlobalPref(GlobalPref.GAME_TRANSLATOR_DEBUG_REGION),
        fontSize: getGlobalPref(GlobalPref.GAME_TRANSLATOR_FONT_SIZE),
        verticalPosition: getGlobalPref(GlobalPref.GAME_TRANSLATOR_VERTICAL_POSITION),
        backgroundOpacity: getGlobalPref(GlobalPref.GAME_TRANSLATOR_BACKGROUND_OPACITY),
        minimumDisplayTime: Number(getGlobalPref(GlobalPref.GAME_TRANSLATOR_MIN_DISPLAY_TIME)),
    };
}

export class GameTranslator {
    private static instance: GameTranslator;
    private static eventsSetup = false;
    public static getInstance = () => GameTranslator.instance ?? (GameTranslator.instance = new GameTranslator());
    private readonly LOG_TAG = 'GameTranslator';
    private readonly MAX_SCENE_TEXT_LINES = 8;
    private readonly MIN_SCENE_SCAN_INTERVAL = 750;
    private readonly MAX_SCENE_CHANGE_THRESHOLD = 0.005;

    private readonly changeDetector = new FrameChangeDetector();
    private readonly subtitleDetector = new SubtitleDetector();
    private readonly subtitleTracker = new SubtitleTracker();
    private readonly sceneTextTracker = new SceneTextTracker();
    private readonly translationService = new TranslationService(
        () => getGlobalPref(GlobalPref.GAME_TRANSLATOR_DEEPL_PROXY_URL),
    );
    private readonly translationContext = new GameTranslationContext();
    private settings = readSettings();
    private frameCapture: TranslatorFrameCapture | null = null;
    private ocrEngine: TesseractOcrEngine | null = null;
    private stabilizer: TextStabilizer | null = null;
    private overlay: TranslationOverlay | null = null;
    private $video: HTMLVideoElement | null = null;
    private timerId: number | null = null;
    private videoFrameCallbackId: number | null = null;
    private translationAbortController: AbortController | null = null;
    private providerPreparationId = 0;
    private sessionId = 0;
    private ocrBusy = false;
    private analyzePending = false;
    private disabledByError = false;
    private debugMetrics: {
        interval: number;
        changeScore?: number;
        ocrTime?: number;
        translationTime?: number;
        ocrConfidence?: number;
        candidates?: number;
    } = { interval: 333 };

    private constructor() {}

    static setupEvents() {
        if (GameTranslator.eventsSetup) {
            return;
        }
        GameTranslator.eventsSetup = true;

        BxEventBus.Stream.on('state.playing', ({ $video }) => {
            if ($video) {
                GameTranslator.getInstance().start($video);
            }
        });
        BxEventBus.Stream.on('state.stopped', () => {
            GameTranslator.getInstance().stop();
        });
        BxEventBus.Script.on('setting.changed', ({ settingKey }) => {
            if (TRANSLATOR_PREFS.has(settingKey)) {
                GameTranslator.getInstance().onSettingsChanged(settingKey);
            }
        });
    }

    private start($video: HTMLVideoElement) {
        this.settings = readSettings();
        if (!this.settings.enabled) {
            return;
        }

        this.stop();
        if (!('Worker' in window) || !('WebAssembly' in window)) {
            Toast.show('Game Translator', 'WebWorker/WASM is not supported');
            return;
        }

        const sessionId = ++this.sessionId;
        this.initializeTranslationContext(sessionId);
        this.disabledByError = false;
        this.analyzePending = false;
        this.frameCapture = new TranslatorFrameCapture(this.settings.ocrRegion, this.settings.mode);
        this.$video = $video;
        this.ocrEngine = new TesseractOcrEngine();
        this.stabilizer = new TextStabilizer(this.settings.stabilizationInterval, text => {
            if (sessionId === this.sessionId) {
                void this.onStableText(text, sessionId);
            }
        });
        this.overlay = new TranslationOverlay($video, this.settings);
        this.debugMetrics = { interval: this.getAnalysisInterval() };
        this.overlay.updateDebug(this.debugMetrics);
        this.updateOverlayGeometry();
        this.startTimer(sessionId);
        this.prepareProvider();

        BxLogger.info(this.LOG_TAG, 'Started', {
            captureInterval: this.getAnalysisInterval(),
            mode: this.settings.mode,
            region: this.settings.ocrRegion,
            changeThreshold: this.settings.changeThreshold,
        });
    }

    private startTimer(sessionId: number) {
        this.cancelScheduledAnalysis();
        void this.analyze(sessionId);
        this.scheduleNextAnalysis(sessionId);
    }

    private scheduleNextAnalysis(sessionId: number) {
        this.timerId = window.setTimeout(() => {
            this.timerId = null;
            if (sessionId !== this.sessionId || this.disabledByError) {
                return;
            }

            const $video = this.$video;
            if ($video && 'requestVideoFrameCallback' in $video) {
                this.videoFrameCallbackId = $video.requestVideoFrameCallback(() => {
                    this.videoFrameCallbackId = null;
                    if (sessionId !== this.sessionId || this.disabledByError) {
                        return;
                    }

                    void this.analyze(sessionId);
                    this.scheduleNextAnalysis(sessionId);
                });
                return;
            }

            void this.analyze(sessionId);
            this.scheduleNextAnalysis(sessionId);
        }, this.getAnalysisInterval());
    }

    private getAnalysisInterval() {
        return this.settings.mode === GameTranslatorMode.ALL_TEXT
            ? Math.max(this.settings.ocrInterval, this.MIN_SCENE_SCAN_INTERVAL)
            : this.settings.ocrInterval;
    }

    private cancelScheduledAnalysis() {
        if (this.timerId !== null) {
            window.clearTimeout(this.timerId);
            this.timerId = null;
        }
        if (this.videoFrameCallbackId !== null && this.$video && 'cancelVideoFrameCallback' in this.$video) {
            this.$video.cancelVideoFrameCallback(this.videoFrameCallbackId);
            this.videoFrameCallbackId = null;
        }
    }

    private async analyze(sessionId: number) {
        if (sessionId !== this.sessionId || this.disabledByError) {
            return;
        }
        if (this.ocrBusy) {
            this.analyzePending = true;
            return;
        }

        const frameCapture = this.frameCapture;
        const ocrEngine = this.ocrEngine;
        if (!frameCapture || !ocrEngine) {
            return;
        }

        this.updateOverlayGeometry();
        let detectionFrame;
        try {
            detectionFrame = frameCapture.captureForDetection();
        } catch (error) {
            this.handleCaptureError(error);
            return;
        }
        if (!detectionFrame) {
            return;
        }

        if (this.settings.mode === GameTranslatorMode.ALL_TEXT) {
            await this.analyzeScene(detectionFrame, frameCapture, ocrEngine, sessionId);
            return;
        }

        const detection = this.subtitleDetector.detect(detectionFrame);
        this.debugMetrics.candidates = detection.lines.length;
        this.overlay?.updateDebug(this.debugMetrics);
        const trackedLines = this.subtitleTracker.update(detection.lines);
        if (trackedLines === null) {
            return;
        }

        const changeScore = this.changeDetector.compare(detection.signature);
        this.debugMetrics.changeScore = changeScore;
        this.overlay?.updateDebug(this.debugMetrics);
        BxLogger.info(this.LOG_TAG, 'Frame change', changeScore);
        if (!trackedLines.length) {
            this.stabilizer?.push('');
            return;
        }
        if (changeScore < this.settings.changeThreshold) {
            return;
        }

        let $ocrCanvas;
        try {
            $ocrCanvas = frameCapture.captureForOcr(trackedLines);
        } catch (error) {
            this.handleCaptureError(error);
            return;
        }
        if (!$ocrCanvas) {
            return;
        }

        this.ocrBusy = true;
        const startedAt = performance.now();
        try {
            const result = await ocrEngine.recognize($ocrCanvas);
            if (sessionId !== this.sessionId) {
                return;
            }

            const ocrTime = performance.now() - startedAt;
            this.debugMetrics.ocrTime = ocrTime;
            this.debugMetrics.ocrConfidence = result.confidence;
            this.overlay?.updateDebug(this.debugMetrics);
            BxLogger.info(this.LOG_TAG, 'OCR result', {
                executionTime: ocrTime,
                confidence: result.confidence,
                text: result.text,
            });
            const isSubtitle = result.confidence >= MIN_SUBTITLE_OCR_CONFIDENCE
                && isLikelySubtitleText(result.text);
            this.stabilizer?.push(
                isSubtitle ? result.text : '',
                isSubtitle && looksLikeCompleteSubtitle(result.text),
            );
        } catch (error) {
            if (sessionId === this.sessionId) {
                this.handleOcrError(error);
            }
        } finally {
            this.finishOcr(sessionId);
        }
    }

    private async analyzeScene(
        detectionFrame: ImageData,
        frameCapture: TranslatorFrameCapture,
        ocrEngine: TesseractOcrEngine,
        sessionId: number,
    ) {
        const changeScore = this.changeDetector.compare(createSceneSignature(detectionFrame));
        this.debugMetrics.changeScore = changeScore;
        this.overlay?.updateDebug(this.debugMetrics);
        if (
            changeScore < Math.min(this.settings.changeThreshold, this.MAX_SCENE_CHANGE_THRESHOLD)
            && !this.sceneTextTracker.needsConfirmation()
        ) {
            return;
        }

        let $ocrCanvas;
        try {
            $ocrCanvas = frameCapture.captureForSceneOcr();
        } catch (error) {
            this.handleCaptureError(error);
            return;
        }
        if (!$ocrCanvas) {
            return;
        }

        this.ocrBusy = true;
        const ocrStartedAt = performance.now();
        try {
            const recognizedLines = await ocrEngine.recognizeScene($ocrCanvas);
            if (sessionId !== this.sessionId) {
                return;
            }

            const filteredLines = this.selectSceneTextLines(recognizedLines);
            const lines = this.sceneTextTracker.update(filteredLines);
            this.debugMetrics.ocrTime = performance.now() - ocrStartedAt;
            this.debugMetrics.ocrConfidence = lines.length
                ? lines.reduce((sum, line) => sum + line.confidence, 0) / lines.length
                : 0;
            this.debugMetrics.candidates = lines.length;
            this.overlay?.updateDebug(this.debugMetrics);
            if (!lines.length) {
                this.overlay?.clearScene();
                return;
            }

            this.translationAbortController?.abort();
            const abortController = new AbortController();
            this.translationAbortController = abortController;
            const translationStartedAt = performance.now();
            const translatedItems = await this.translateSceneLines(lines, abortController);
            if (sessionId !== this.sessionId || abortController.signal.aborted) {
                return;
            }

            this.debugMetrics.translationTime = performance.now() - translationStartedAt;
            this.overlay?.updateDebug(this.debugMetrics);
            if (translatedItems.length) {
                this.overlay?.showScene(translatedItems);
            } else {
                this.overlay?.clearScene();
            }
        } catch (error) {
            if (sessionId === this.sessionId) {
                this.handleOcrError(error);
            }
        } finally {
            this.finishOcr(sessionId);
        }
    }

    private selectSceneTextLines(lines: SceneOcrLine[]) {
        const seen = new Set<string>();
        const candidates = lines.filter(line => {
            const key = normalizeText(line.text);
            if (
                line.confidence < MIN_SCENE_OCR_CONFIDENCE
                || line.box.height < 0.012
                || line.box.height > 0.25
                || !isLikelyEnglishSceneText(line.text, line.confidence)
                || seen.has(key)
            ) {
                return false;
            }

            seen.add(key);
            return true;
        });

        return candidates
            .sort((left, right) => {
                const leftPriority = left.confidence + Math.min(25, left.box.width * left.box.height * 2000);
                const rightPriority = right.confidence + Math.min(25, right.box.width * right.box.height * 2000);
                return rightPriority - leftPriority;
            })
            .slice(0, this.MAX_SCENE_TEXT_LINES)
            .sort((left, right) => left.box.y - right.box.y || left.box.x - right.box.x);
    }

    private async translateSceneLines(lines: SceneOcrLine[], abortController: AbortController) {
        const context = this.translationContext.snapshot();
        const translatedItems: TranslatedSceneText[] = [];

        for (let index = 0; index < lines.length; index += 2) {
            const batch = lines.slice(index, index + 2);
            const translations = await Promise.all(batch.map(async line => {
                try {
                    const result = await this.translationService.translate(
                        this.settings.provider,
                        line.text,
                        abortController.signal,
                        context,
                    );
                    if (normalizeText(result.text) === normalizeText(line.text)) {
                        return null;
                    }
                    return {
                        originalText: line.text,
                        translatedText: result.text,
                        box: line.box,
                    };
                } catch (error) {
                    if (!abortController.signal.aborted) {
                        BxLogger.warning(this.LOG_TAG, 'Scene text translation failed', line.text, error);
                    }
                    return null;
                }
            }));

            translatedItems.push(...translations.filter(item => item !== null));
            if (abortController.signal.aborted) {
                break;
            }
        }

        return translatedItems;
    }

    private finishOcr(sessionId: number) {
        if (sessionId === this.sessionId) {
            this.ocrBusy = false;
        }
        if (this.analyzePending && sessionId === this.sessionId) {
            this.analyzePending = false;
            if (this.settings.mode === GameTranslatorMode.SUBTITLES) {
                void this.analyze(sessionId);
            }
        }
    }

    private async onStableText(text: string, sessionId: number) {
        if (!text) {
            this.overlay?.clear();
            return;
        }

        this.translationAbortController?.abort();
        this.translationAbortController = null;

        BxLogger.info(this.LOG_TAG, 'Stabilized text', text);
        const abortController = new AbortController();
        this.translationAbortController = abortController;

        try {
            const context = this.translationContext.snapshot();
            this.translationContext.rememberSubtitle(text);
            const result = await this.translationService.translate(this.settings.provider, text, abortController.signal, context);
            if (sessionId !== this.sessionId || abortController.signal.aborted) {
                return;
            }

            this.debugMetrics.translationTime = result.latency;
            this.overlay?.updateDebug(this.debugMetrics);
            this.overlay?.show(text, result.text);
            BxLogger.info(this.LOG_TAG, result.cacheHit ? 'Translation cache hit' : 'Translation cache miss', {
                latency: result.latency,
                translatedText: result.text,
            });
        } catch (error) {
            if (sessionId === this.sessionId && !abortController.signal.aborted) {
                BxLogger.error(this.LOG_TAG, 'Translation failed', error);
                this.overlay?.showError('Translation unavailable');
            }
        } finally {
            if (this.translationAbortController === abortController) {
                this.translationAbortController = null;
            }
        }
    }

    private handleOcrError(error: unknown) {
        this.disabledByError = true;
        this.cancelScheduledAnalysis();
        BxLogger.error(this.LOG_TAG, 'OCR unavailable', error);
        this.overlay?.showError('OCR unavailable (check CSP/network access)');
        Toast.show('Game Translator', 'OCR unavailable');
    }

    private handleCaptureError(error: unknown) {
        this.disabledByError = true;
        this.cancelScheduledAnalysis();
        BxLogger.error(this.LOG_TAG, 'Frame capture unavailable', error);
        this.overlay?.showError('Frame capture unavailable');
        Toast.show('Game Translator', 'Frame capture unavailable');
    }

    private updateOverlayGeometry() {
        const frameCapture = this.frameCapture;
        if (!frameCapture) {
            return;
        }

        const $player = frameCapture.getDisplayElement();
        this.overlay?.updateGeometry($player, frameCapture.getRegion());
    }

    private onSettingsChanged(settingKey?: GlobalPref) {
        const previousSettings = this.settings;
        this.settings = readSettings();
        const providerChanged = previousSettings.provider !== this.settings.provider;
        const providerConfigChanged = settingKey === GlobalPref.GAME_TRANSLATOR_DEEPL_PROXY_URL;
        const modeChanged = previousSettings.mode !== this.settings.mode;

        if (!this.settings.enabled) {
            this.stop();
            return;
        }

        if (!previousSettings.enabled && this.settings.enabled && STATES.isPlaying) {
            const $video = ScreenshotManager.getInstance().getCurrentFrameSource(StreamPlayerElement.VIDEO);
            if ($video instanceof HTMLVideoElement) {
                this.start($video);
            }
            return;
        }

        if (providerChanged || providerConfigChanged) {
            this.translationAbortController?.abort();
            this.translationAbortController = null;
            this.translationService.destroy();
        }
        if (modeChanged) {
            this.translationAbortController?.abort();
            this.translationAbortController = null;
        }
        if (providerChanged && this.settings.provider === GameTranslatorProvider.DEEPL_CONTEXT) {
            this.loadGameDescription(this.sessionId);
        }
        if (providerChanged || providerConfigChanged || !previousSettings.enabled) {
            this.prepareProvider();
        }

        if (!this.frameCapture || !this.overlay || !this.stabilizer) {
            return;
        }

        this.frameCapture.setRegion(this.settings.ocrRegion);
        this.frameCapture.setMode(this.settings.mode);
        this.changeDetector.reset();
        this.subtitleTracker.reset();
        this.sceneTextTracker.reset();
        this.stabilizer.setDelay(this.settings.stabilizationInterval);
        this.overlay.applySettings(this.settings);
        modeChanged && this.overlay.resetContent();
        this.updateOverlayGeometry();

        if (previousSettings.ocrInterval !== this.settings.ocrInterval || modeChanged) {
            this.debugMetrics.interval = this.getAnalysisInterval();
            this.startTimer(this.sessionId);
        }
    }

    private prepareProvider() {
        if (this.settings.provider === GameTranslatorProvider.MY_MEMORY) {
            return;
        }

        const preparationId = ++this.providerPreparationId;
        let showedDownloadToast = false;
        void this.translationService.prepare(this.settings.provider, progress => {
            if (preparationId !== this.providerPreparationId) {
                return;
            }
            BxLogger.info(this.LOG_TAG, 'Translation model download', Math.round(progress * 100));
            if (!showedDownloadToast) {
                showedDownloadToast = true;
                Toast.show('Game Translator', 'Downloading Chrome translation model…');
            }
        }).then(() => {
            if (preparationId === this.providerPreparationId) {
                BxLogger.info(this.LOG_TAG, 'Translation provider is ready', this.settings.provider);
                showedDownloadToast && Toast.show('Game Translator', 'Chrome Translator is ready');
            }
        }).catch(error => {
            if (preparationId === this.providerPreparationId) {
                BxLogger.error(this.LOG_TAG, 'Translation provider preparation failed', error);
                const status = this.settings.provider === GameTranslatorProvider.DEEPL_CONTEXT
                    ? 'Configure the DeepL proxy URL'
                    : 'Chrome Translator is unavailable; select MyMemory';
                Toast.show('Game Translator', status);
            }
        });
    }

    private initializeTranslationContext(sessionId: number) {
        const titleInfo = STATES.currentStream.titleInfo;
        this.translationContext.reset(titleInfo?.product.title);
        if (this.settings.provider === GameTranslatorProvider.DEEPL_CONTEXT) {
            this.loadGameDescription(sessionId);
        }
    }

    private loadGameDescription(sessionId: number) {
        const titleInfo = STATES.currentStream.titleInfo;
        const productId = titleInfo?.details.productId;
        if (!productId) {
            return;
        }

        void XboxApi.getProductContext(productId).then(context => {
            if (sessionId !== this.sessionId || !context) {
                return;
            }
            if (!titleInfo?.product.title && context.title) {
                this.translationContext.reset(context.title);
            }
            this.translationContext.setGameDescription(context.description);
            BxLogger.info(this.LOG_TAG, 'Game translation context ready', {
                title: context.title,
                hasDescription: !!context.description,
            });
        });
    }

    private stop() {
        this.sessionId++;
        this.providerPreparationId++;
        this.cancelScheduledAnalysis();
        this.$video = null;
        this.translationAbortController?.abort();
        this.translationAbortController = null;
        this.translationService.destroy();
        this.translationContext.reset();
        this.stabilizer?.reset();
        this.stabilizer = null;
        this.changeDetector.reset();
        this.subtitleTracker.reset();
        this.sceneTextTracker.reset();
        this.frameCapture?.destroy();
        this.frameCapture = null;
        this.overlay?.destroy();
        this.overlay = null;
        const ocrEngine = this.ocrEngine;
        this.ocrEngine = null;
        ocrEngine && void ocrEngine.terminate();
        this.ocrBusy = false;
        this.analyzePending = false;
        this.disabledByError = false;

        BxLogger.info(this.LOG_TAG, 'Stopped');
    }
}
