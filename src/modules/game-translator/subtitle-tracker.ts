import type { SubtitleLine } from "./subtitle-detector";

const REQUIRED_MATCHING_FRAMES = 2;
const MAX_CENTER_X_SHIFT = 0.15;
const MAX_CENTER_Y_SHIFT = 0.08;
const MAX_HEIGHT_SHIFT = 0.08;

function centerX(line: SubtitleLine) {
    return line.x + line.width / 2;
}

function centerY(line: SubtitleLine) {
    return line.y + line.height / 2;
}

export function haveSimilarSubtitlePositions(left: SubtitleLine[], right: SubtitleLine[]) {
    if (left.length !== right.length) {
        return false;
    }

    return left.every((line, index) => {
        const other = right[index];
        return Math.abs(centerX(line) - centerX(other)) <= MAX_CENTER_X_SHIFT
            && Math.abs(centerY(line) - centerY(other)) <= MAX_CENTER_Y_SHIFT
            && Math.abs(line.height - other.height) <= MAX_HEIGHT_SHIFT;
    });
}

/**
 * Requires a newly detected subtitle position to survive two frames. Once a
 * position is confirmed, text changes inside it pass immediately.
 */
export class SubtitleTracker {
    private candidateLines: SubtitleLine[] | null = null;
    private matchingFrames = 0;

    update(lines: SubtitleLine[]): SubtitleLine[] | null {
        const sortedLines = [...lines].sort((left, right) => left.y - right.y);
        if (this.candidateLines && haveSimilarSubtitlePositions(this.candidateLines, sortedLines)) {
            this.candidateLines = sortedLines;
            this.matchingFrames++;
        } else {
            this.candidateLines = sortedLines;
            this.matchingFrames = 1;
        }

        return this.matchingFrames >= REQUIRED_MATCHING_FRAMES ? sortedLines : null;
    }

    reset() {
        this.candidateLines = null;
        this.matchingFrames = 0;
    }
}
