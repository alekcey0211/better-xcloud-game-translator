import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { createWorker, OEM, PSM } from "tesseract.js";

import { createOcrLayout } from "../src/modules/game-translator/ocr-layout.ts";
import { SubtitleDetector, type PixelFrame, type SubtitleLine } from "../src/modules/game-translator/subtitle-detector.ts";
import { SubtitleTracker } from "../src/modules/game-translator/subtitle-tracker.ts";
import { normalizeText } from "../src/modules/game-translator/text-stabilizer.ts";

const OCR_REGION = { x: 0.05, y: 0.62, width: 0.9, height: 0.35 };
const DETECTION_WIDTH = 640;
const OCR_WIDTH = 1280;

const samples = [
    { time: 4, expected: ['only one way', 'sickness'] },
    { time: 12, expected: ['what'] },
    { time: 24, expected: ['blood', 'stood by', 'fed me', "didn't you"] },
    { time: 27, expected: ["didn't know"] },
    { time: 30, expected: ['save your breath', 'brother'] },
    { time: 33, expected: ['looks like', 'need it'] },
    { time: 36, expected: [] },
];

function run(command: string, args: string[]) {
    const result = spawnSync(command, args, { maxBuffer: 20 * 1024 * 1024 });
    if (result.status !== 0) {
        throw new Error(`${command} failed: ${result.stderr.toString()}`);
    }

    return result.stdout;
}

function getVideoSize(videoPath: string) {
    const output = run('ffprobe', [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'csv=s=x:p=0',
        videoPath,
    ]).toString().trim();
    const [width, height] = output.split('x').map(Number);
    if (!width || !height) {
        throw new Error(`Unable to read video size: ${output}`);
    }

    return { width, height };
}

function captureRegion(videoPath: string, time: number, targetWidth: number, videoSize: ReturnType<typeof getVideoSize>): PixelFrame {
    const cropWidth = Math.round(videoSize.width * OCR_REGION.width);
    const cropHeight = Math.round(videoSize.height * OCR_REGION.height);
    const cropX = Math.round(videoSize.width * OCR_REGION.x);
    const cropY = Math.round(videoSize.height * OCR_REGION.y);
    const targetHeight = Math.round(targetWidth * cropHeight / cropWidth);
    const data = run('ffmpeg', [
        '-loglevel', 'error',
        '-ss', String(time),
        '-i', videoPath,
        '-frames:v', '1',
        '-vf', `crop=${cropWidth}:${cropHeight}:${cropX}:${cropY},scale=${targetWidth}:${targetHeight}:flags=lanczos`,
        '-f', 'rawvideo',
        '-pix_fmt', 'rgba',
        '-',
    ]);

    return {
        data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
        width: targetWidth,
        height: targetHeight,
    };
}

function createPgm(frame: PixelFrame, lines: SubtitleLine[]) {
    const layout = createOcrLayout(lines, frame.width, frame.height);
    const pixels = Buffer.alloc(layout.width * layout.height);

    for (const line of layout.lines) {
        for (let y = 0; y < line.targetHeight; y++) {
            const sourceY = Math.min(
                frame.height - 1,
                line.sourceY + Math.floor(y * line.sourceHeight / line.targetHeight),
            );
            for (let x = 0; x < line.targetWidth; x++) {
                const sourceX = Math.min(
                    frame.width - 1,
                    line.sourceX + Math.floor(x * line.sourceWidth / line.targetWidth),
                );
                const sourceIndex = (sourceY * frame.width + sourceX) * 4;
                const luminance = (
                    54 * frame.data[sourceIndex]
                    + 183 * frame.data[sourceIndex + 1]
                    + 19 * frame.data[sourceIndex + 2]
                ) >> 8;
                const targetIndex = (line.targetY + y) * layout.width + line.targetX + x;
                pixels[targetIndex] = Math.max(0, Math.min(255, Math.round((luminance - 128) * 1.8 + 128)));
            }
        }
    }

    return Buffer.concat([Buffer.from(`P5\n${layout.width} ${layout.height}\n255\n`), pixels]);
}

const videoPath = process.argv[2] && resolve(process.argv[2]);
if (!videoPath) {
    console.error('Usage: node --experimental-strip-types scripts/test-game-translator-video.ts <video.mp4>');
    process.exit(2);
}

const videoSize = getVideoSize(videoPath);
const detector = new SubtitleDetector();
mkdirSync('.cache/tesseract', { recursive: true });
const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
    cachePath: '.cache/tesseract',
});
await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    preserve_interword_spaces: '1',
    user_defined_dpi: '180',
});

let failed = false;
try {
    for (const sample of samples) {
        const tracker = new SubtitleTracker();
        const firstDetectionFrame = captureRegion(videoPath, sample.time, DETECTION_WIDTH, videoSize);
        tracker.update(detector.detect(firstDetectionFrame).lines);
        const confirmedTime = sample.time + 0.125;
        const detectionFrame = captureRegion(videoPath, confirmedTime, DETECTION_WIDTH, videoSize);
        const detection = detector.detect(detectionFrame);
        const lines = tracker.update(detection.lines) || [];
        const ocrFrame = captureRegion(videoPath, confirmedTime, OCR_WIDTH, videoSize);
        const startedAt = performance.now();
        let text = '';
        if (lines.length) {
            const result = await worker.recognize(createPgm(ocrFrame, lines));
            if (result.data.confidence >= 35) {
                text = result.data.text.replace(/\s+/g, ' ').trim();
            }
        }

        const normalized = normalizeText(text);
        const missing = sample.expected.filter(fragment => !normalized.includes(normalizeText(fragment)));
        const passed = sample.expected.length ? !missing.length : !text;
        failed ||= !passed;
        console.log(
            `${passed ? '✓' : '✗'} ${sample.time.toFixed(1)}s`,
            `${Math.round(performance.now() - startedAt)}ms`,
            `lines=${lines.length}`,
            `ocrCalls=${lines.length ? 1 : 0}`,
            JSON.stringify(text),
            missing.length ? `missing=${JSON.stringify(missing)}` : '',
        );
    }
} finally {
    await worker.terminate();
}

process.exitCode = failed ? 1 : 0;
