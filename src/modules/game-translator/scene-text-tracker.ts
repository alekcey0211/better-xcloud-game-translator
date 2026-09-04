import type { SceneOcrLine } from "./ocr-engine";
import { normalizeText } from "./text-stabilizer.ts";

const REQUIRED_OBSERVATIONS = 2;
const MAX_CENTER_X_SHIFT = 0.06;
const MAX_CENTER_Y_SHIFT = 0.04;

type TrackedSceneLine = {
    line: SceneOcrLine;
    observations: number;
};

function centerX(line: SceneOcrLine) {
    return line.box.x + line.box.width / 2;
}

function centerY(line: SceneOcrLine) {
    return line.box.y + line.box.height / 2;
}

export function haveSimilarSceneText(left: SceneOcrLine, right: SceneOcrLine) {
    const leftText = normalizeText(left.text);
    const rightText = normalizeText(right.text);
    const shorterText = leftText.length < rightText.length ? leftText : rightText;
    const longerText = leftText.length < rightText.length ? rightText : leftText;
    const textMatches = leftText === rightText
        || (shorterText.length >= 4 && longerText.includes(shorterText) && shorterText.length / longerText.length >= 0.75);

    return textMatches
        && Math.abs(centerX(left) - centerX(right)) <= MAX_CENTER_X_SHIFT
        && Math.abs(centerY(left) - centerY(right)) <= MAX_CENTER_Y_SHIFT;
}

/** Requires scene text to be recognized at the same position twice. */
export class SceneTextTracker {
    private trackedLines: TrackedSceneLine[] = [];
    private confirmationPending = false;

    update(lines: SceneOcrLine[]) {
        const isConfirmationScan = this.confirmationPending;
        const matchedPrevious = new Set<number>();
        const nextLines = lines.map(line => {
            const previousIndex = this.trackedLines.findIndex((candidate, index) => (
                !matchedPrevious.has(index) && haveSimilarSceneText(candidate.line, line)
            ));
            if (previousIndex < 0) {
                return { line, observations: 1 };
            }

            matchedPrevious.add(previousIndex);
            return {
                line,
                observations: this.trackedLines[previousIndex].observations + 1,
            };
        });

        // A scene change gets at most one extra OCR pass. Otherwise unstable texture noise
        // could keep requesting expensive full-screen OCR indefinitely.
        this.trackedLines = isConfirmationScan
            ? nextLines.filter(candidate => candidate.observations >= REQUIRED_OBSERVATIONS)
            : nextLines;
        this.confirmationPending = !isConfirmationScan
            && nextLines.some(candidate => candidate.observations < REQUIRED_OBSERVATIONS);

        return nextLines
            .filter(candidate => candidate.observations >= REQUIRED_OBSERVATIONS)
            .map(candidate => candidate.line);
    }

    needsConfirmation() {
        return this.confirmationPending;
    }

    reset() {
        this.trackedLines = [];
        this.confirmationPending = false;
    }
}
