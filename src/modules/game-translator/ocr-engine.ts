import { createWorker, OEM, PSM, type Worker as TesseractWorker } from "tesseract.js";

import { BxLogger } from "@/utils/bx-logger";

const TESSERACT_VERSION = '7.0.0';
const TESSERACT_CORE_VERSION = '7.0.0';

export interface OcrEngine {
    recognize(image: HTMLCanvasElement): Promise<OcrResult>;
    terminate(): Promise<void>;
}

export type OcrResult = {
    text: string;
    confidence: number;
};

function cleanRecognizedLine(text: string, confidence: number) {
    const line = text.replace(/\s+/g, ' ').trim();
    const letters = line.match(/[a-z]/gi)?.length || 0;
    const visibleCharacters = line.match(/[^\s]/g)?.length || 0;
    if (confidence < 35 || letters < 2 || !visibleCharacters || letters / visibleCharacters < 0.45) {
        return '';
    }

    return line;
}

export class TesseractOcrEngine implements OcrEngine {
    private readonly LOG_TAG = 'GameTranslator.OCR';
    private worker: TesseractWorker | null = null;
    private workerPromise: Promise<TesseractWorker> | null = null;
    private terminated = false;

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
        const result = await worker.recognize(image);

        return {
            text: cleanRecognizedLine(result.data.text, result.data.confidence),
            confidence: result.data.confidence,
        };
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
        }
    }
}
