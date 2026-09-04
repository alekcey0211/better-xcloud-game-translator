export type PixelFrame = Pick<ImageData, 'data' | 'width' | 'height'>;

export type SubtitleLine = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type SubtitleDetection = {
    lines: SubtitleLine[];
    signature: Uint8Array;
};

const SIGNATURE_SCALE = 4;
const MIN_LUMINANCE = 135;
const MAX_NEUTRAL_SATURATION = 90;
const VERY_BRIGHT_LUMINANCE = 205;
const MIN_LOCAL_CONTRAST = 24;
const MAX_SUBTITLE_LINES = 3;

function getLuminance(red: number, green: number, blue: number) {
    return (54 * red + 183 * green + 19 * blue) >> 8;
}

/**
 * Finds compact, horizontally centered bright text lines inside an OCR region.
 * The detector intentionally does not try to recognize text. It creates a cheap
 * subtitle-shaped signature that ignores most moving game scenery.
 */
export class SubtitleDetector {
    detect(frame: PixelFrame): SubtitleDetection {
        const { data, width, height } = frame;
        const luminance = new Uint8Array(width * height);
        const ink = new Uint8Array(width * height);
        const rowInk = new Uint16Array(height);
        const sampleRadius = Math.max(2, Math.round(width / 320));
        const horizontalMargin = Math.round(width * 0.05);

        for (let pixelIndex = 0, dataIndex = 0; pixelIndex < luminance.length; pixelIndex++, dataIndex += 4) {
            luminance[pixelIndex] = getLuminance(data[dataIndex], data[dataIndex + 1], data[dataIndex + 2]);
        }

        for (let y = sampleRadius; y < height - sampleRadius; y++) {
            for (let x = horizontalMargin; x < width - horizontalMargin; x++) {
                const pixelIndex = y * width + x;
                const dataIndex = pixelIndex * 4;
                const value = luminance[pixelIndex];
                if (value < MIN_LUMINANCE) {
                    continue;
                }

                const red = data[dataIndex];
                const green = data[dataIndex + 1];
                const blue = data[dataIndex + 2];
                const saturation = Math.max(red, green, blue) - Math.min(red, green, blue);
                if (saturation > MAX_NEUTRAL_SATURATION && value < VERY_BRIGHT_LUMINANCE) {
                    continue;
                }

                const darkestNeighbour = Math.min(
                    luminance[pixelIndex - sampleRadius],
                    luminance[pixelIndex + sampleRadius],
                    luminance[pixelIndex - sampleRadius * width],
                    luminance[pixelIndex + sampleRadius * width],
                );
                if (value - darkestNeighbour < MIN_LOCAL_CONTRAST) {
                    continue;
                }

                ink[pixelIndex] = 1;
                rowInk[y]++;
            }
        }

        const minimumRowInk = Math.max(4, Math.round(width * 0.006));
        const activeRows: number[] = [];
        for (let y = 0; y < height; y++) {
            if (rowInk[y] >= minimumRowInk) {
                activeRows.push(y);
            }
        }

        const rowGroups: number[][] = [];
        for (const y of activeRows) {
            const group = rowGroups[rowGroups.length - 1];
            if (!group || y - group[group.length - 1] > 2) {
                rowGroups.push([y]);
            } else {
                group.push(y);
            }
        }

        const lines: SubtitleLine[] = [];
        const signatureWidth = Math.ceil(width / SIGNATURE_SCALE);
        const signatureHeight = Math.ceil(height / SIGNATURE_SCALE);
        const signature = new Uint8Array(signatureWidth * signatureHeight);
        const horizontalPadding = Math.round(width * 0.03);
        const verticalPadding = Math.max(3, Math.round(height * 0.05));

        for (const group of rowGroups) {
            const firstRow = group[0];
            const lastRow = group[group.length - 1];
            const centerY = (firstRow + lastRow) / 2 / height;
            if (group.length < 2 || centerY < 0.42 || lastRow - firstRow + 1 > height * 0.18) {
                continue;
            }

            let firstColumn = width;
            let lastColumn = 0;
            for (let y = Math.max(0, firstRow - 1); y <= Math.min(height - 1, lastRow + 1); y++) {
                for (let x = horizontalMargin; x < width - horizontalMargin; x++) {
                    if (ink[y * width + x]) {
                        firstColumn = Math.min(firstColumn, x);
                        lastColumn = Math.max(lastColumn, x);
                    }
                }
            }

            const centerX = (firstColumn + lastColumn) / 2 / width;
            if (firstColumn >= lastColumn || lastColumn - firstColumn < width * 0.05 || centerX < 0.18 || centerX > 0.82) {
                continue;
            }

            const x0 = Math.max(0, firstColumn - horizontalPadding);
            const x1 = Math.min(width, lastColumn + horizontalPadding + 1);
            const y0 = Math.max(0, firstRow - verticalPadding);
            const y1 = Math.min(height, lastRow + verticalPadding + 1);
            lines.push({
                x: x0 / width,
                y: y0 / height,
                width: (x1 - x0) / width,
                height: (y1 - y0) / height,
            });

            for (let y = Math.max(0, firstRow - 1); y <= Math.min(height - 1, lastRow + 1); y++) {
                for (let x = Math.max(0, firstColumn - 2); x <= Math.min(width - 1, lastColumn + 2); x++) {
                    if (ink[y * width + x]) {
                        signature[Math.floor(y / SIGNATURE_SCALE) * signatureWidth + Math.floor(x / SIGNATURE_SCALE)] = 1;
                    }
                }
            }
        }

        if (lines.length > MAX_SUBTITLE_LINES) {
            lines.length = 0;
            signature.fill(0);
        }

        return { lines, signature };
    }
}
