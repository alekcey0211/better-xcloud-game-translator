export type TranslationContext = {
    gameTitle?: string;
    gameDescription?: string;
    previousSubtitles: string[];
};

const MAX_DESCRIPTION_LENGTH = 600;
const MAX_PREVIOUS_SUBTITLES = 2;

function compactText(text: string) {
    return text.replaceAll(/\s+/g, ' ').trim();
}

export function buildDeepLContext(context?: TranslationContext) {
    if (!context) {
        return '';
    }

    const sections: string[] = [];
    if (context.gameTitle) {
        sections.push(`Game title: ${compactText(context.gameTitle)}`);
    }
    if (context.gameDescription) {
        sections.push(`Game description: ${compactText(context.gameDescription).slice(0, MAX_DESCRIPTION_LENGTH)}`);
    }
    if (context.previousSubtitles.length) {
        sections.push(`Previous dialogue:\n${context.previousSubtitles.slice(-MAX_PREVIOUS_SUBTITLES).join('\n')}`);
    }

    return sections.join('\n');
}

export class GameTranslationContext {
    private gameTitle = '';
    private gameDescription = '';
    private previousSubtitles: string[] = [];

    reset(gameTitle = '') {
        this.gameTitle = compactText(gameTitle);
        this.gameDescription = '';
        this.previousSubtitles = [];
    }

    setGameDescription(description: string) {
        this.gameDescription = compactText(description).slice(0, MAX_DESCRIPTION_LENGTH);
    }

    rememberSubtitle(text: string) {
        const subtitle = compactText(text);
        if (!subtitle || this.previousSubtitles.at(-1) === subtitle) {
            return;
        }

        this.previousSubtitles.push(subtitle);
        this.previousSubtitles = this.previousSubtitles.slice(-MAX_PREVIOUS_SUBTITLES);
    }

    snapshot(): TranslationContext {
        return {
            gameTitle: this.gameTitle || undefined,
            gameDescription: this.gameDescription || undefined,
            previousSubtitles: [...this.previousSubtitles],
        };
    }
}
