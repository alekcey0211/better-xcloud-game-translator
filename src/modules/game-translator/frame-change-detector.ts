export class FrameChangeDetector {
    private previousFrame: Uint8Array | null = null;

    compare(frame: Uint8Array, updateBaseline = true) {
        const previousFrame = this.previousFrame;
        if (updateBaseline) {
            this.previousFrame = new Uint8Array(frame);
        }

        if (!previousFrame || previousFrame.length !== frame.length) {
            return frame.some(Boolean) ? 1 : 0;
        }

        let difference = 0;
        let union = 0;
        for (let index = 0; index < frame.length; index++) {
            const current = frame[index];
            const previous = previousFrame[index];
            if (current || previous) {
                union++;
                if (current !== previous) {
                    difference++;
                }
            }
        }

        return union ? difference / union : 0;
    }

    reset() {
        this.previousFrame = null;
    }
}
