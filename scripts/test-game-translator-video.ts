import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { createWorker, OEM, PSM } from "tesseract.js";

import { SubtitleDetector, type PixelFrame, type SubtitleLine } from "../src/modules/game-translator/subtitle-detector.ts";
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

function createPgm(frame: PixelFrame, line: SubtitleLine) {
    const x0 = Math.round(line.x * frame.width);
    const y0 = Math.round(line.y * frame.height);
    const width = Math.max(1, Math.round(line.width * frame.width));
    const height = Math.max(1, Math.round(line.height * frame.height));
    const pixels = Buffer.alloc(width * height);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const sourceIndex = ((y0 + y) * frame.width + x0 + x) * 4;
            const luminance = (
                54 * frame.data[sourceIndex]
                + 183 * frame.data[sourceIndex + 1]
                + 19 * frame.data[sourceIndex + 2]
            ) >> 8;
            pixels[y * width + x] = Math.max(0, Math.min(255, Math.round((luminance - 128) * 1.8 + 128)));
        }
    }

    return Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`), pixels]);
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
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
    preserve_interword_spaces: '1',
    user_defined_dpi: '180',
});

let failed = false;
try {
    for (const sample of samples) {
        const detectionFrame = captureRegion(videoPath, sample.time, DETECTION_WIDTH, videoSize);
        const detection = detector.detect(detectionFrame);
        const ocrFrame = captureRegion(videoPath, sample.time, OCR_WIDTH, videoSize);
        const recognizedLines: string[] = [];
        const startedAt = performance.now();
        for (const line of detection.lines) {
            const result = await worker.recognize(createPgm(ocrFrame, line));
            if (result.data.confidence >= 35) {
                recognizedLines.push(result.data.text.replace(/\s+/g, ' ').trim());
            }
        }

        const text = recognizedLines.join(' ');
        const normalized = normalizeText(text);
        const missing = sample.expected.filter(fragment => !normalized.includes(normalizeText(fragment)));
        const passed = sample.expected.length ? !missing.length : !text;
        failed ||= !passed;
        console.log(
            `${passed ? '✓' : '✗'} ${sample.time.toFixed(1)}s`,
            `${Math.round(performance.now() - startedAt)}ms`,
            `lines=${detection.lines.length}`,
            JSON.stringify(text),
            missing.length ? `missing=${JSON.stringify(missing)}` : '',
        );
    }
} finally {
    await worker.terminate();
}

process.exitCode = failed ? 1 : 0;
