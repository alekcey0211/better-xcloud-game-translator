// Compatibility entry point. Fixtures are versioned; an external video is no longer required.
if (process.argv.length > 2) {
    throw new Error('Run npm run test:game-translator:video without a video path. To regenerate fixtures, use scripts/extract-game-translator-fixtures.mjs.');
}
await import('../tests/game-translator-video.test.ts');
