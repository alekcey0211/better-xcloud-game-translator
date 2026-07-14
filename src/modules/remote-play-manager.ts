import { STATES } from "@utils/global";
import { Toast } from "@utils/toast";
import { BxEvent } from "@utils/bx-event";
import { t } from "@utils/translation";
import { localRedirect } from "@modules/ui/ui";
import { BxLogger } from "@utils/bx-logger";
import { HeaderSection } from "./ui/header";
import { GlobalPref } from "@/enums/pref-keys";
import { getGlobalPref, setGlobalPref } from "@/utils/pref-utils";
import { RemotePlayDialog } from "./ui/dialog/remote-play-dialog";
import { BlockFeature } from "@/enums/pref-values";

export const enum RemotePlayConsoleState {
    ON = 'On',
    OFF = 'Off',
    STANDBY = 'ConnectedStandby',
    UNKNOWN = 'Unknown',
}

type AuthUserTokens = {
    tokens: Array<{
        identityType: 'XToken';
        relyingParty: string;
        tokenData: {
            token: string;
            expiration: string;
            issueInstant: string;
            userHash: string;
            userConsents: string;
        };
        sandboxId: 'RETAIL';
    }>;
};

type RemotePlayRegion = {
    name: string;
    baseUri: string;
    isDefault: boolean;
};

type RemotePlayConsole = {
    deviceName: string;
    serverId: string;
    powerState: RemotePlayConsoleState;
    consoleType: string;
    // playPath: string;
    // outOfHomeWarning: string;
    // wirelessWarning: string;
    // isDevKit: string;
};

export class RemotePlayManager {
    private static instance: RemotePlayManager | null | undefined;
    public static getInstance(): typeof RemotePlayManager['instance'] {
        if (typeof RemotePlayManager.instance === 'undefined') {
            if (!getGlobalPref(GlobalPref.BLOCK_FEATURES).includes(BlockFeature.REMOTE_PLAY)) {
                RemotePlayManager.instance = new RemotePlayManager();
            } else {
                RemotePlayManager.instance = null;
            }
        }

        return RemotePlayManager.instance;
    }
    private readonly LOG_TAG = 'RemotePlayManager';

    private isInitialized = false;

    private XCLOUD_TOKEN!: string;
    private XHOME_TOKEN!: string;

    private consoles!: Array<RemotePlayConsole>;
    private regions: Array<RemotePlayRegion> = [];

    private constructor() {
        BxLogger.info(this.LOG_TAG, 'constructor()');
    }

    initialize() {
        if (this.isInitialized) {
            return;
        }

        this.isInitialized = true;

        this.requestXhomeToken(() => {
            this.getConsolesList(() => {
                BxLogger.info(this.LOG_TAG, 'Consoles', this.consoles);

                STATES.supportedRegion && HeaderSection.getInstance().showRemotePlayButton();
                BxEvent.dispatch(window, BxEvent.REMOTE_PLAY_READY);
            });
        });
    }

    getXcloudToken() {
        return this.XCLOUD_TOKEN;
    }

    setXcloudToken(token: string) {
        this.XCLOUD_TOKEN = token;
    }

    getXhomeToken() {
        return this.XHOME_TOKEN;
    }

    getConsoles() {
        return this.consoles;
    }


    private requestXhomeToken(callback: any) {
        if (this.XHOME_TOKEN) {
            callback();
            return;
        }

        let GSSV_TOKEN;
        try {
            GSSV_TOKEN = JSON.parse(localStorage.getItem('xboxcom_xbl_user_info')!).tokens['http://gssv.xboxlive.com/'].token;
        } catch (e) {
            const today = new Date();

            for (let i = 0; i < localStorage.length; i++){
                const key = localStorage.key(i)!;
                if (!key.startsWith('Auth.User.')) {
                    continue;
                }

                const authUser = JSON.parse(localStorage.getItem(key)!) as AuthUserTokens;
                for (const token of authUser.tokens) {
                    if (!token.relyingParty.includes('gssv.xboxlive.com')) {
                        continue;
                    }

                    const tokenData = token.tokenData;
                    const expiration = new Date(tokenData.expiration);
                    if (expiration > today) {
                        GSSV_TOKEN = tokenData.token;
                        break;
                    }
                }

                if (GSSV_TOKEN) {
                    break;
                }
            }
        }

        if (!GSSV_TOKEN) {
            console.error('xHome: Could not get GSSV_TOKEN');
            return;
        }

        const request = new Request('https://xhome.gssv-play-prod.xboxlive.com/v2/login/user', {
            method: 'POST',
            body: JSON.stringify({
                offeringId: 'xhome',
                token: GSSV_TOKEN,
            }),
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
            },
        });

        fetch(request).then(resp => resp.json())
            .then(json => {
                this.regions = json.offeringSettings.regions;
                this.XHOME_TOKEN = json.gsToken;
                callback();
            });
    }

    private async getConsolesList(callback: any) {
        if (this.consoles) {
            callback();
            return;
        }

        const options = {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.XHOME_TOKEN}`,
                },
            };

        // Start with "isDefault" = true first
        this.regions.sort((a: RemotePlayRegion, b: RemotePlayRegion) => {
            return a.isDefault ? -1 : 0;
        })

        // Test servers one by one
        for (const region of this.regions) {
            try {
                const request = new Request(`${region.baseUri}/v6/servers/home?mr=50`, options);
                const resp = await fetch(request);

                const json = await resp.json();
                if (json.results.length === 0) {
                    continue;
                }

                this.consoles = json.results;

                // Store working server
                STATES.remotePlay.server = region.baseUri;

                break;
            } catch (e) {}
        }

        // None of the servers worked
        if (!STATES.remotePlay.server) {
            this.consoles = [];
        }

        callback();
    }

    play(serverId: string, resolution?: string) {
        if (resolution) {
            setGlobalPref(GlobalPref.REMOTE_PLAY_STREAM_RESOLUTION, resolution, 'ui');
        }

        localRedirect('/consoles/launch/' + serverId);
    }

    togglePopup(force = null) {
        if (!this.isReady()) {
            Toast.show(t('getting-consoles-list'));
            return;
        }

        if (this.consoles.length === 0) {
            Toast.show(t('no-consoles-found'), '', { instant: true });
            return;
        }

        RemotePlayDialog.getInstance().show();
    }

    isReady() {
        return this.consoles !== null;
    }
}
