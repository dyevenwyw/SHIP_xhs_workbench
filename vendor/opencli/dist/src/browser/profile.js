import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
export const DEFAULT_CONTEXT_ID = 'default';
function profileConfigPath() {
    const baseDir = process.env.OPENCLI_CONFIG_DIR || path.join(os.homedir(), '.opencli');
    return path.join(baseDir, 'browser-profiles.json');
}
export function normalizeContextId(value) {
    const trimmed = value?.trim();
    return trimmed || undefined;
}
export function emptyProfileConfig() {
    return { version: 1, aliases: {} };
}
export function loadProfileConfig() {
    try {
        const raw = fs.readFileSync(profileConfigPath(), 'utf-8');
        const parsed = JSON.parse(raw);
        const aliases = parsed.aliases && typeof parsed.aliases === 'object'
            ? Object.fromEntries(Object.entries(parsed.aliases).filter((entry) => {
                const [key, value] = entry;
                return typeof key === 'string' && key.trim().length > 0
                    && typeof value === 'string' && value.trim().length > 0;
            }))
            : {};
        return {
            version: 1,
            aliases,
            ...(typeof parsed.defaultContextId === 'string' && parsed.defaultContextId.trim()
                ? { defaultContextId: parsed.defaultContextId.trim() }
                : {}),
        };
    }
    catch {
        return emptyProfileConfig();
    }
}
export function saveProfileConfig(config) {
    const target = profileConfigPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}
export function resolveProfileSelection(profile) {
    const config = loadProfileConfig();
    const explicit = normalizeContextId(profile) ?? normalizeContextId(process.env.OPENCLI_PROFILE);
    if (explicit)
        return { contextId: config.aliases[explicit] ?? explicit, source: 'explicit' };
    const preferred = normalizeContextId(config.defaultContextId);
    if (preferred)
        return { contextId: config.aliases[preferred] ?? preferred, source: 'preferred' };
    return undefined;
}
/**
 * Map a selection to wire/connect routing params. Exactly one of the two
 * fields is set — `contextId` is a hard requirement, `preferredContextId`
 * lets the daemon arbitrate against live connections.
 */
export function profileRouteParams(selection) {
    if (!selection)
        return {};
    return selection.source === 'explicit'
        ? { contextId: selection.contextId }
        : { preferredContextId: selection.contextId };
}
export function resolveProfileContextId(profile) {
    return resolveProfileSelection(profile)?.contextId;
}
export function aliasForContextId(config, contextId) {
    for (const [alias, id] of Object.entries(config.aliases)) {
        if (id === contextId)
            return alias;
    }
    return undefined;
}
export function renameProfile(contextId, alias) {
    const normalizedContextId = normalizeContextId(contextId);
    const normalizedAlias = normalizeContextId(alias);
    if (!normalizedContextId)
        throw new Error('profile contextId is required');
    if (!normalizedAlias)
        throw new Error('profile alias is required');
    const config = loadProfileConfig();
    for (const [existingAlias, existingContextId] of Object.entries(config.aliases)) {
        if (existingAlias !== normalizedAlias && existingContextId === normalizedContextId) {
            delete config.aliases[existingAlias];
        }
    }
    config.aliases[normalizedAlias] = normalizedContextId;
    saveProfileConfig(config);
    return config;
}
export function setDefaultProfile(profile) {
    const contextId = resolveProfileContextId(profile) ?? normalizeContextId(profile);
    if (!contextId)
        throw new Error('profile is required');
    const config = loadProfileConfig();
    config.defaultContextId = contextId;
    saveProfileConfig(config);
    return config;
}
