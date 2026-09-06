export const enum UiSection {
    ALL_GAMES = 'all-games',
    FRIENDS = 'friends',
    MOST_POPULAR = 'most-popular',
    NATIVE_MKB = 'native-mkb',
    NEWS = 'news',
    TOUCH = 'touch',
    BOYG = 'byog',
    RECENTLY_ADDED = 'recently-added',
    LEAVING_SOON = 'leaving-soon',
    GENRES = 'genres',
}

export const enum GameBarPosition {
    BOTTOM_LEFT = 'bottom-left',
    BOTTOM_RIGHT = 'bottom-right',
    OFF = 'off',
};

export const enum UiLayout {
    TV = 'tv',
    NORMAL = 'normal',
    DEFAULT = 'default',
}

export const enum LoadingScreenRocket {
    SHOW = 'show',
    HIDE = 'hide',
    HIDE_QUEUE = 'hide-queue',
}

export const enum StreamResolution {
    DIM_720P = '720p',
    DIM_1080P = '1080p',
    DIM_1080P_HQ = '1080p-hq',
    AUTO = 'auto',
}

export const enum CodecProfile {
    DEFAULT = 'default',
    LOW = 'low',
    NORMAL = 'normal',
    HIGH = 'high',
};

export const enum TouchControllerMode {
    DEFAULT = 'default',
    ALL = 'all',
    OFF = 'off',
}

export const enum TouchControllerStyleStandard {
    DEFAULT = 'default',
    WHITE = 'white',
    MUTED = 'muted',
}

export const enum TouchControllerStyleCustom {
    DEFAULT = 'default',
    MUTED = 'muted',
}

export const enum DeviceVibrationMode {
    ON = 'on',
    AUTO = 'auto',
    OFF = 'off',
}

export const enum NativeMkbMode {
    DEFAULT = 'default',
    ON = 'on',
    OFF = 'off',
}

export const enum StreamStat {
    PING = 'ping',
    JITTER = 'jit',
    RESOLUTION = 'res',
    FPS = 'fps',
    BITRATE = 'btr',
    DECODE_TIME = 'dt',
    PACKETS_LOST = 'pl',
    FRAMES_LOST = 'fl',
    DOWNLOAD = 'dl',
    UPLOAD = 'ul',
    PLAYTIME = 'play',
    BATTERY = 'batt',
    CLOCK = 'time',
};

export const enum StreamStatPosition {
    TOP_LEFT = 'top-left',
    TOP_CENTER = 'top-center',
    TOP_RIGHT = 'top-right',
}

export const enum VideoRatio {
    '16:9' = '16:9',
    '16:10' = '16:10',
    '18:9' = '18:9',
    '20:9' = '20:9',
    '21:9' = '21:9',
    '3:2' = '3:2',
    '4:3' = '4:3',
    '5:4' = '5:4',
    FILL = 'fill',
}

export const enum VideoPosition {
    CENTER = 'center',
    TOP = 'top',
    TOP_HALF = 'top-half',
    BOTTOM = 'bottom',
    BOTTOM_HALF = 'bottom-half',
}

export const enum VideoPowerPreference {
    DEFAULT = 'default',
    LOW_POWER = 'low-power',
    HIGH_PERFORMANCE = 'high-performance',
}

export const enum StreamPlayerType {
    VIDEO = 'default',
    WEBGL2 = 'webgl2',
    WEBGPU = 'webgpu',
}

export const enum StreamVideoProcessing {
    USM = 'usm',
    CAS = 'cas',
}

export const enum StreamVideoProcessingMode {
    QUALITY = 'quality',
    PERFORMANCE = 'performance',
}

export const enum BlockFeature {
    CHAT = 'chat',
    FRIENDS = 'friends',
    NOTIFICATIONS_INVITES = 'notifications-invites',
    NOTIFICATIONS_ACHIEVEMENTS = 'notifications-achievements',
    REMOTE_PLAY = 'remote-play',
}

export const enum UiTheme {
    DEFAULT = 'default',
    DARK_OLED = 'dark-oled',
}

export const enum GameTranslatorOcrRegion {
    TOP = 'top-35',
    CENTER = 'center-35',
    BOTTOM = 'bottom-35',
}

export const enum GameTranslatorProvider {
    DICTIONARY = 'dictionary',
    BROWSER = 'browser',
    DEEPL_CONTEXT = 'deepl-context',
    MY_MEMORY = 'my-memory',
}
