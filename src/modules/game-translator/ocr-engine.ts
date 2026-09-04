import { createWorker, OEM, PSM, type Worker as TesseractWorker } from "tesseract.js";

import { BxLogger } from "@/utils/bx-logger";

const TESSERACT_VERSION = '7.0.0';
const TESSERACT_CORE_VERSION = '7.0.0';

export interface OcrEngine {
    recognize(image: HTMLCanvasElement): Promise<OcrResult>;
    recognizeScene(image: HTMLCanvasElement): Promise<SceneOcrLine[]>;
    terminate(): Promise<void>;
}

export type OcrResult = {
    text: string;
    confidence: number;
};

export type SceneOcrLine = OcrResult & {
    box: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
};

function cleanRecognizedLine(text: string, confidence: number) {
    const line = text.replace(/\s+/g, ' ').trim();
    const letters = line.match(/[a-z]/gi)?.length || 0;
    const visibleCharacters = line.match(/[^\s]/g)?.length || 0;
    if (confidence < 35 || letters < 3 || !visibleCharacters || letters / visibleCharacters < 0.45) {
        return '';
    }

    return line;
}

export class TesseractOcrEngine implements OcrEngine {
    private readonly LOG_TAG = 'GameTranslator.OCR';
    private worker: TesseractWorker | null = null;
    private workerPromise: Promise<TesseractWorker> | null = null;
    private terminated = false;
    private pageSegmentationMode: PSM | null = null;

    private async getWorker() {
        if (this.terminated) {
            throw new Error('OCR engine has been terminated');
        }

        if (!this.workerPromise) {
            this.workerPromise = createWorker('eng', OEM.LSTM_ONLY, {
                workerPath: `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/worker.min.js`,
                corePath: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${TESSERACT_CORE_VERSION}`,
                langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
                workerBlobURL: true,
                logger: message => BxLogger.info(this.LOG_TAG, message.status, message.progress),
                errorHandler: error => BxLogger.error(this.LOG_TAG, error),
            }).then(async worker => {
                await worker.setParameters({
                    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
                    preserve_interword_spaces: '1',
                    user_defined_dpi: '180',
                });
                this.pageSegmentationMode = PSM.SINGLE_BLOCK;

                if (this.terminated) {
                    await worker.terminate();
                    throw new Error('OCR engine was terminated during initialization');
                }

                this.worker = worker;
                return worker;
            });
        }

        return this.workerPromise;
    }

    async recognize(image: HTMLCanvasElement) {
        const worker = await this.getWorker();
        await this.setPageSegmentationMode(worker, PSM.SINGLE_BLOCK);
        const result = await worker.recognize(image);

        return {
            text: cleanRecognizedLine(result.data.text, result.data.confidence),
            confidence: result.data.confidence,
        };
    }

    async recognizeScene(image: HTMLCanvasElement) {
        const worker = await this.getWorker();
        await this.setPageSegmentationMode(worker, PSM.SPARSE_TEXT);
        const result = await worker.recognize(image, {}, { text: true, blocks: true });
        const lines: SceneOcrLine[] = [];

        for (const block of result.data.blocks || []) {
            for (const paragraph of block.paragraphs) {
                for (const line of paragraph.lines) {
                    const text = cleanRecognizedLine(line.text, line.confidence);
                    const width = line.bbox.x1 - line.bbox.x0;
                    const height = line.bbox.y1 - line.bbox.y0;
                    if (!text || width <= 0 || height <= 0) {
                        continue;
                    }

                    lines.push({
                        text,
                        confidence: line.confidence,
                        box: {
                            x: line.bbox.x0 / image.width,
                            y: line.bbox.y0 / image.height,
                            width: width / image.width,
                            height: height / image.height,
                        },
                    });
                }
            }
        }

        return lines;
    }

    private async setPageSegmentationMode(worker: TesseractWorker, mode: PSM) {
        if (this.pageSegmentationMode === mode) {
            return;
        }

        await worker.setParameters({ tessedit_pageseg_mode: mode });
        this.pageSegmentationMode = mode;
    }

    async terminate() {
        this.terminated = true;

        try {
            const worker = this.worker || await this.workerPromise;
            await worker?.terminate();
        } catch (error) {
            BxLogger.warning(this.LOG_TAG, 'Failed to terminate worker', error);
        } finally {
            this.worker = null;
            this.workerPromise = null;
            this.pageSegmentationMode = null;
        }
    }
}
