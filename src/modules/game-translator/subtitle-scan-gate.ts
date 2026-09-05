import { FrameChangeDetector } from "./frame-change-detector.ts";

const MAX_RESCAN_INTERVAL = 1500;

export class SubtitleScanGate {
    private readonly changeDetector = new FrameChangeDetector();
    private lastScanAt = -Infinity;

    evaluate(signature: Uint8Array, threshold: number, now: number) {
        // Compare with the last OCR frame, not the previous timer tick. Gradual
        // fades and typewriter text must accumulate enough change to trigger OCR.
        const changeScore = this.changeDetector.compare(signature, false);
        const shouldScan = changeScore >= threshold || now - this.lastScanAt >= MAX_RESCAN_INTERVAL;
        if (shouldScan) {
            this.changeDetector.compare(signature);
            this.lastScanAt = now;
        }
        return { changeScore, shouldScan };
    }

    reset() {
        this.changeDetector.reset();
        this.lastScanAt = -Infinity;
    }
}
