import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../tests/fixtures/game-translator/quest-2026-09-05/', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
const video = process.argv[2];
if (!video) {
    throw new Error('Usage: node scripts/extract-game-translator-fixtures.mjs <Untitled.mp4>');
}
const hash = createHash('sha256').update(readFileSync(video)).digest('hex');
if (hash !== manifest.source.sha256) {
    throw new Error('Wrong source video: SHA-256 does not match the annotated recording.');
}

for (const sample of manifest.samples) {
    const perspective = sample.quad.map(([x, y], i) => `x${i}=${x}:y${i}=${y}`).join(':');
    const result = spawnSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(sample.timeSeconds), '-i', video,
        '-vf', `perspective=${perspective}:sense=source:interpolation=cubic,scale=${manifest.width}:${manifest.height}:flags=lanczos`,
        '-frames:v', '1', '-map_metadata', '-1', resolve(directory, sample.file),
    ], { stdio: 'inherit' });
    if (result.error || result.status !== 0) {
        throw new Error(`Fixture extraction failed: ${sample.id}: ${result.error || result.status}`);
    }
    console.log(`${sample.timeSeconds}s -> ${sample.file}`);
}
