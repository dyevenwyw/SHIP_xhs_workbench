export declare const DEFAULT_CONTEXT_ID = "default";
export type ProfileConfig = {
    version: 1;
    defaultContextId?: string;
    aliases: Record<string, string>;
};
export declare function normalizeContextId(value: string | undefined | null): string | undefined;
export declare function emptyProfileConfig(): ProfileConfig;
export declare function loadProfileConfig(): ProfileConfig;
export declare function saveProfileConfig(config: ProfileConfig): void;
export type ProfileSelection = {
    contextId: string;
    /**
     * 'explicit' — the user demanded this profile right now (--profile argument
     * or OPENCLI_PROFILE env): route strictly and fail loud if it is offline.
     * 'preferred' — the persisted default from browser-profiles.json. A default
     * is a preference, not a requirement: its lifetime routinely exceeds the
     * extension instance it names (reinstalling the extension regenerates the
     * contextId), so the daemon may fall back to the only connected profile
     * when the preferred one is offline.
     */
    source: 'explicit' | 'preferred';
};
export declare function resolveProfileSelection(profile?: string): ProfileSelection | undefined;
/**
 * Map a selection to wire/connect routing params. Exactly one of the two
 * fields is set — `contextId` is a hard requirement, `preferredContextId`
 * lets the daemon arbitrate against live connections.
 */
export declare function profileRouteParams(selection: ProfileSelection | undefined): {
    contextId?: string;
    preferredContextId?: string;
};
export declare function resolveProfileContextId(profile?: string): string | undefined;
export declare function aliasForContextId(config: ProfileConfig, contextId: string): string | undefined;
export declare function renameProfile(contextId: string, alias: string): ProfileConfig;
export declare function setDefaultProfile(profile: string): ProfileConfig;
