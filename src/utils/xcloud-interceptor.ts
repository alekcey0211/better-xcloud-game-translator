import { isFullVersion } from "@macros/build" with { type: "macro" };

import { LoadingScreen } from "@modules/loading-screen";
import { RemotePlayManager } from "@/modules/remote-play-manager";
import { StreamBadges } from "@modules/stream/stream-badges";
import { TouchController } from "@modules/touch-controller";
import { NATIVE_FETCH, BX_FLAGS } from "./bx-flags";
import { STATES } from "./global";
import { generateMsDeviceInfo, getOsNameFromResolution, patchIceCandidates } from "./network";
import { getPreferredServerRegion } from "./region";
import { BypassServerIps } from "@/enums/bypass-servers";
import { GlobalPref, StreamPref } from "@/enums/pref-keys";
import { NativeMkbMode, TouchControllerMode } from "@/enums/pref-values";
import { BxEventBus } from "./bx-event-bus";
import { getGlobalPref, getStreamPref } from "./pref-utils";

export class XcloudInterceptor {
    private static readonly SERVER_EXTRA_INFO: Record<string, [string, string, ServerContinent]> = {
        // North America
        EASTUS: ['🇺🇸', 'East US', 'america-north'],
        EASTUS2: ['🇺🇸', 'East US 2', 'america-north'],
        NORTHCENTRALUS: ['🇺🇸', 'North Central US', 'america-north'],
        SOUTHCENTRALUS: ['🇺🇸', 'South Central US', 'america-north'],
        WESTUS: ['🇺🇸', 'West US', 'america-north'],
        WESTUS2: ['🇺🇸', 'West US 2', 'america-north'],
        WESTUS3: ['🇺🇸', 'West US 3', 'america-north'],
        MEXICOCENTRAL: ['🇲🇽', 'Mexico Central', 'america-north'],

        // South America
        BRAZILSOUTH: ['🇧🇷', 'Brazil South', 'america-south'],
        CHILECENTRAL: ['🇨🇱', 'Chile Central', 'america-south'],

        // Asia
        JAPANEAST: ['🇯🇵', 'Japan East', 'asia'],
        KOREACENTRAL: ['🇰🇷', 'Korea Central', 'asia'],
        CENTRALINDIA: ['🇮🇳', 'Central India', 'asia'],
        SOUTHINDIA: ['🇮🇳', 'South India', 'asia'],

        // Australia
        AUSTRALIAEAST: ['🇦🇺', 'Australia East', 'australia'],
        AUSTRALIASOUTHEAST: ['🇦🇺', 'Australia South East', 'australia'],

        // Europe
        SWEDENCENTRAL: ['🇸🇪', 'Sweden Central', 'europe'],
        UKSOUTH: ['🇬🇧', 'UK South', 'europe'],
        WESTEUROPE: ['🇳🇱', 'West Europe', 'europe'],
    };

    private static async handleLogin(request: RequestInfo | URL, init?: RequestInit) {
        const bypassServer = getGlobalPref(GlobalPref.SERVER_BYPASS_RESTRICTION);
        if (bypassServer !== 'off') {
            const ip = BypassServerIps[bypassServer as keyof typeof BypassServerIps];
            ip && (request as Request).headers.set('X-Forwarded-For', ip);
        }

        let response;
        try {
            response = await NATIVE_FETCH(request, init);
        } catch (e) {
            BxEventBus.Script.emit('xcloud.server', { status: 'error' });
            return;
        }
        if (response.status !== 200) {
            // Unsupported region
            !STATES.serverRegions && BxEventBus.Script.emit('xcloud.server', { status: 'unavailable' });
            return response;
        }

        const obj = await response.clone().json();

        // Store xCloud token
        if (isFullVersion()) {
            RemotePlayManager.getInstance()?.setXcloudToken(obj.gsToken);
        }

        // Get server list
        const serverRegex = /\/\/(\w+)\./;
        const serverExtra = XcloudInterceptor.SERVER_EXTRA_INFO;
        const serverOrder = Object.keys(serverExtra);

        let region: ServerRegion;
        for (region of obj.offeringSettings.regions) {
            const regionName = region.name.toUpperCase() as keyof typeof serverExtra;
            let shortName = region.name;

            if (region.isDefault) {
                STATES.selectedRegion = Object.assign({}, region);
            }

            let match = serverRegex.exec(region.baseUri);
            if (match) {
                shortName = match[1] as string;
                if (serverExtra[regionName]) {
                    const info = serverExtra[regionName];
                    shortName = info[0] + ' ' + shortName;
                    region.displayName = info[1];
                    region.contintent = info[2];
                } else {
                    region.contintent = 'other';
                    serverOrder.push(regionName);
                    BX_FLAGS.Debug && alert('New server: ' + regionName);
                }
            }

            region.shortName = shortName.toUpperCase();
            STATES.serverRegions[region.name] = Object.assign({}, region);
        }

        STATES.serverRegions =  Object.fromEntries(
            serverOrder.filter(k => k in STATES.serverRegions).map(k => [k, STATES.serverRegions[k]])
        );

        const preferredRegion = getPreferredServerRegion();
        if (preferredRegion && preferredRegion in STATES.serverRegions) {
            const tmp = Object.assign({}, STATES.serverRegions[preferredRegion]);
            tmp.isDefault = true;

            obj.offeringSettings.regions = [tmp];
            STATES.selectedRegion = tmp;
        }

        STATES.gsToken = obj.gsToken;
        BxEventBus.Script.emit('xcloud.server', { status: 'ready' });

        response.json = () => Promise.resolve(obj);
        return response;
    }

    private static async handlePlay(request: RequestInfo | URL, init?: RequestInit) {
        BxEventBus.Stream.emit('state.loading', {});

        const PREF_STREAM_TARGET_RESOLUTION = getGlobalPref(GlobalPref.STREAM_RESOLUTION);
        const PREF_STREAM_PREFERRED_LOCALE = getGlobalPref(GlobalPref.STREAM_PREFERRED_LOCALE);

        const url = (typeof request === 'string') ? request : (request as Request).url;
        const parsedUrl = new URL(url);

        let badgeRegion: string = parsedUrl.host.split('.', 1)[0] as string;
        for (let regionName in STATES.serverRegions) {
            const region = STATES.serverRegions[regionName];
            if (region && parsedUrl.origin === region.baseUri) {
                badgeRegion = regionName;
                break;
            }
        }
        StreamBadges.getInstance().setRegion(badgeRegion);

        const clone = (request as Request).clone();
        const body = await clone.json();

        const headers: { [index: string]: string } = {};
        for (const pair of (clone.headers as any).entries()) {
            headers[pair[0]] = pair[1];
        }

        // Force stream's resolution
        if (PREF_STREAM_TARGET_RESOLUTION !== 'auto') {
            const osName = getOsNameFromResolution(PREF_STREAM_TARGET_RESOLUTION);
            headers['x-ms-device-info'] = JSON.stringify(generateMsDeviceInfo(osName));
            body.settings.osName = osName;
        }

        // Override "locale" value
        if (PREF_STREAM_PREFERRED_LOCALE !== 'default') {
            body.settings.locale = PREF_STREAM_PREFERRED_LOCALE;
        }

        const newRequest = new Request(request, {
            body: JSON.stringify(body),
            headers: headers,
        });

        return NATIVE_FETCH(newRequest);
    }

    private static async handleWaitTime(request: RequestInfo | URL, init?: RequestInit) {
        const response = await NATIVE_FETCH(request, init);

        if (getGlobalPref(GlobalPref.LOADING_SCREEN_SHOW_WAIT_TIME)) {
            const json = await response.clone().json();
            if (json.estimatedAllocationTimeInSeconds > 0) {
                // Setup wait time overlay
                LoadingScreen.setupWaitTime(json.estimatedTotalWaitTimeInSeconds);
            }
        }

        return response;
    }

    private static async handleConfiguration(request: RequestInfo | URL, init?: RequestInit) {
        if ((request as Request).method !== 'GET') {
            return NATIVE_FETCH(request, init);
        }

        // Touch controller for all games
        if (isFullVersion() && getGlobalPref(GlobalPref.TOUCH_CONTROLLER_MODE) === TouchControllerMode.ALL) {
            const titleInfo = STATES.currentStream.titleInfo;
            if (titleInfo?.details.hasTouchSupport) {
                TouchController.disable();
            } else {
                TouchController.enable();
            }
        }

        // Intercept configurations
        const response = await NATIVE_FETCH(request, init);
        const text = await response.clone().text();
        if (!text.length) {
            return response;
        }

        BxEventBus.Stream.emit('state.starting', {});

        const obj = JSON.parse(text);
        let overrides = JSON.parse(obj.clientStreamingConfigOverrides || '{}') || {};

        overrides.inputConfiguration = overrides.inputConfiguration || {};
        overrides.inputConfiguration.enableVibration = true;

        // https://github.com/redphx/better-xcloud/issues/914#issuecomment-4400078173
        if (getStreamPref(StreamPref.LOCAL_CO_OP_ENABLED)) {
            overrides.inputConfiguration.useUnreliableInput = false;
        }

        let overrideMkb: boolean | null = null;

        if (getGlobalPref(GlobalPref.NATIVE_MKB_MODE) === NativeMkbMode.ON || (STATES.currentStream.titleInfo && BX_FLAGS.ForceNativeMkbTitles?.includes(STATES.currentStream.titleInfo.details.productId))) {
            overrideMkb = true;
        }

        if (getGlobalPref(GlobalPref.NATIVE_MKB_MODE) === NativeMkbMode.OFF) {
            overrideMkb = false;
        }

        if (overrideMkb !== null) {
            overrides.inputConfiguration = Object.assign(overrides.inputConfiguration, {
                enableMouseInput: overrideMkb,
                enableKeyboardInput: overrideMkb,
            });
        }

        // Enable touch controller
        if (isFullVersion() && TouchController.isEnabled()) {
            overrides.inputConfiguration.enableTouchInput = true;
            overrides.inputConfiguration.maxTouchPoints = 10;
        }

        // Enable mic
        if (getGlobalPref(GlobalPref.AUDIO_MIC_ON_PLAYING)) {
            overrides.audioConfiguration = overrides.audioConfiguration || {};
            overrides.audioConfiguration.enableMicrophone = true;
        }

        obj.clientStreamingConfigOverrides = JSON.stringify(overrides);

        response.json = () => Promise.resolve(obj);
        response.text = () => Promise.resolve(JSON.stringify(obj));

        return response;
    }

    static async handle(request: RequestInfo | URL, init?: RequestInit) {
        let url = (typeof request === 'string') ? request : (request as Request).url;

        // Server list
        if (url.endsWith('/v2/login/user')) {
            return XcloudInterceptor.handleLogin(request, init);
        } else if (url.endsWith('/sessions/cloud/play')) {  // Get session
            return XcloudInterceptor.handlePlay(request, init);
        } else if (url.includes('xboxlive.com') && url.includes('/waittime/')) {
            return XcloudInterceptor.handleWaitTime(request, init);
        } else if (url.endsWith('/configuration')) {
            return XcloudInterceptor.handleConfiguration(request, init);
        } else if (url && url.endsWith('/ice') && url.includes('/sessions/') && (request as Request).method === 'GET') {
            return patchIceCandidates(request as Request);
        }

        return NATIVE_FETCH(request, init);
    }
}
