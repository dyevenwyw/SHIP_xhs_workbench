/**
 * Core registry: Strategy enum, Arg/CliCommand interfaces, cli() registration.
 */
export var Strategy;
(function (Strategy) {
    Strategy["PUBLIC"] = "public";
    Strategy["LOCAL"] = "local";
    Strategy["COOKIE"] = "cookie";
    Strategy["INTERCEPT"] = "intercept";
    Strategy["UI"] = "ui";
})(Strategy || (Strategy = {}));
const _registry = globalThis.__opencli_registry__ ??= new Map();
export function cli(opts) {
    const cmd = {
        site: opts.site,
        name: opts.name,
        aliases: opts.aliases,
        description: opts.description ?? '',
        access: opts.access,
        example: opts.example,
        domain: opts.domain,
        strategy: opts.strategy,
        browser: opts.browser,
        args: opts.args ?? [],
        columns: opts.columns,
        func: opts.func,
        pipeline: opts.pipeline,
        footerExtra: opts.footerExtra,
        validateArgs: opts.validateArgs,
        navigateBefore: opts.navigateBefore,
        siteSession: opts.siteSession,
        defaultWindowMode: opts.defaultWindowMode,
        defaultFormat: opts.defaultFormat,
        authStatus: opts.authStatus,
    };
    registerCommand(cmd);
    return _registry.get(fullName(cmd));
}
export function getRegistry() {
    return _registry;
}
export function fullName(cmd) {
    return `${cmd.site}/${cmd.name}`;
}
export function strategyLabel(cmd) {
    return cmd.strategy ?? Strategy.PUBLIC;
}
/**
 * Normalize a command's runtime fields. This is the single place where
 * `strategy` is decoded into the concrete fields that the execution path
 * reads (`browser`, `navigateBefore`). After normalization, execution code
 * (resolvePreNav, shouldUseBrowserSession) never reads `cmd.strategy`.
 *
 * `strategy` itself is preserved as metadata for `opencli list`, cascade
 * probe, adapter generation, and human documentation.
 *
 * Override priority (highest wins):
 *   1. Explicit field on the command (`browser: false`, `navigateBefore: false`)
 *   2. Derived from strategy + domain (the defaults below)
 */
function normalizeCommand(cmd) {
    assertCommandAccess(cmd);
    assertSiteSession(cmd);
    const strategy = cmd.strategy ?? (cmd.browser === false ? Strategy.PUBLIC : Strategy.COOKIE);
    const browser = cmd.browser ?? (strategy !== Strategy.PUBLIC && strategy !== Strategy.LOCAL);
    let navigateBefore = cmd.navigateBefore;
    if (navigateBefore === undefined) {
        if (strategy === Strategy.COOKIE && cmd.domain) {
            navigateBefore = `https://${cmd.domain}`;
        }
        else if (strategy !== Strategy.PUBLIC && strategy !== Strategy.LOCAL) {
            // Non-PUBLIC without domain: needs authenticated browser context
            // but no specific pre-navigation URL. `true` signals this to
            // shouldUseBrowserSession without triggering resolvePreNav.
            navigateBefore = true;
        }
    }
    return browser
        ? { ...cmd, strategy, browser: true, navigateBefore }
        : { ...cmd, strategy, browser: false, navigateBefore };
}
function assertCommandAccess(cmd) {
    if (cmd.access === 'read' || cmd.access === 'write')
        return;
    const key = `${cmd.site}/${cmd.name}`;
    throw new Error(`Command ${key} must declare access: 'read' | 'write'`);
}
function assertSiteSession(cmd) {
    if (cmd.siteSession === undefined)
        return;
    const key = `${cmd.site}/${cmd.name}`;
    if (cmd.siteSession !== 'ephemeral' && cmd.siteSession !== 'persistent') {
        throw new Error(`Command ${key} siteSession must be one of: ephemeral, persistent`);
    }
}
export function registerCommand(cmd) {
    const normalized = normalizeCommand(cmd);
    const canonicalKey = fullName(normalized);
    const existing = _registry.get(canonicalKey);
    if (existing?.aliases) {
        for (const alias of existing.aliases) {
            _registry.delete(`${existing.site}/${alias}`);
        }
    }
    const aliases = normalizeAliases(normalized.aliases, normalized.name);
    normalized.aliases = aliases.length > 0 ? aliases : undefined;
    _registry.set(canonicalKey, normalized);
    for (const alias of aliases) {
        _registry.set(`${normalized.site}/${alias}`, normalized);
    }
}
function normalizeAliases(aliases, commandName) {
    if (!Array.isArray(aliases) || aliases.length === 0)
        return [];
    const seen = new Set();
    const normalized = [];
    for (const alias of aliases) {
        const value = typeof alias === 'string' ? alias.trim() : '';
        if (!value || value === commandName || seen.has(value))
            continue;
        seen.add(value);
        normalized.push(value);
    }
    return normalized;
}
