import type { SubtitleLine } from "./subtitle-detector";

export const OCR_LINE_HEIGHT = 48;
export const OCR_LINE_GAP = 12;

export type OcrLineLayout = {
    sourceX: number;
    sourceY: number;
    sourceWidth: number;
    sourceHeight: number;
    targetX: number;
    targetY: number;
    targetWidth: number;
    targetHeight: number;
};

export type OcrLayout = {
    width: number;
    height: number;
    lines: OcrLineLayout[];
};

export function createOcrLayout(lines: SubtitleLine[], sourceWidth: number, sourceHeight: number): OcrLayout {
    const sortedLines = [...lines].sort((left, right) => left.y - right.y);
    const layouts = sortedLines.map(line => {
        const cropWidth = Math.max(1, Math.round(line.width * sourceWidth));
        const cropHeight = Math.max(1, Math.round(line.height * sourceHeight));

        return {
            sourceX: Math.round(line.x * sourceWidth),
            sourceY: Math.round(line.y * sourceHeight),
            sourceWidth: cropWidth,
            sourceHeight: cropHeight,
            targetX: 0,
            targetY: 0,
            targetWidth: Math.min(sourceWidth, Math.max(1, Math.round(cropWidth * OCR_LINE_HEIGHT / cropHeight))),
            targetHeight: OCR_LINE_HEIGHT,
        };
    });
    const width = Math.max(1, ...layouts.map(line => line.targetWidth));

    for (let index = 0; index < layouts.length; index++) {
        const line = layouts[index];
        line.targetX = Math.round((width - line.targetWidth) / 2);
        line.targetY = index * (OCR_LINE_HEIGHT + OCR_LINE_GAP);
    }

    return {
        width,
        height: layouts.length
            ? layouts.length * OCR_LINE_HEIGHT + (layouts.length - 1) * OCR_LINE_GAP
            : 1,
        lines: layouts,
    };
}
