import { spawnSync } from "node:child_process";
import { createOcrLayout } from "../../src/modules/game-translator/ocr-layout.ts";
import type { PixelFrame, SubtitleLine } from "../../src/modules/game-translator/subtitle-detector.ts";

export function decodeFixture(path: string, width: number, height: number): PixelFrame {
    const result = spawnSync('ffmpeg', [
        '-v', 'error', '-i', path, '-vf', `scale=${width}:${height}:flags=lanczos`,
        '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-',
    ], { maxBuffer: 8 * 1024 * 1024 });
    if (result.error || result.status !== 0) {
        throw new Error(`ffmpeg is required: ${result.error || result.stderr.toString()}`);
    }
    if (result.stdout.length !== width * height * 4) {
        throw new Error(`Invalid fixture size: ${path}`);
    }
    return { data: new Uint8ClampedArray(result.stdout), width, height };
}

export function createPgm(frame: PixelFrame, lines: SubtitleLine[]) {
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

