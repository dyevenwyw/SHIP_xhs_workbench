/**
 * Browser session manager — auto-spawns daemon and provides IPage.
 */
import { Page } from './page.js';
import { profileRouteParams, resolveProfileSelection } from './profile.js';
import { ensureBrowserBridgeReady } from './daemon-lifecycle.js';
const DAEMON_SPAWN_TIMEOUT = 10000; // 10s to wait for daemon + extension
/**
 * Browser factory: manages daemon lifecycle and provides IPage instances.
 */
export class BrowserBridge {
    _state = 'idle';
    _page = null;
    get state() {
        return this._state;
    }
    async connect(opts = {}) {
        if (this._state === 'connected' && this._page)
            return this._page;
        if (this._state === 'connecting')
            throw new Error('Already connecting');
        if (this._state === 'closing')
            throw new Error('Session is closing');
        if (this._state === 'closed')
            throw new Error('Session is closed');
        this._state = 'connecting';
        try {
            // Requirement vs preference: only an explicit contextId pins daemon
            // readiness and command routing to a specific profile. A preferred one
            // (config default) is arbitrated by the daemon against live connections,
            // so a stale default cannot make connect() wait for a dead profile.
            const routing = opts.contextId || opts.preferredContextId
                ? { contextId: opts.contextId, preferredContextId: opts.preferredContextId }
                : profileRouteParams(resolveProfileSelection());
            await this._ensureDaemon(opts.timeout, routing.contextId, routing.preferredContextId);
            if (!opts.session?.trim())
                throw new Error('Browser session is required');
            this._page = new Page(opts.session.trim(), opts.idleTimeout, routing.contextId, opts.windowMode, opts.surface, opts.siteSession, routing.preferredContextId);
            this._state = 'connected';
            return this._page;
        }
        catch (err) {
            this._state = 'idle';
            throw err;
        }
    }
    async close() {
        if (this._state === 'closed')
            return;
        this._state = 'closing';
        // We don't kill the daemon — it's persistent.
        // Just clean up our reference.
        this._page = null;
        this._state = 'closed';
    }
    async _ensureDaemon(timeoutSeconds, contextId, preferredContextId) {
        await ensureBrowserBridgeReady({
            timeoutSeconds: timeoutSeconds ?? Math.ceil(DAEMON_SPAWN_TIMEOUT / 1000),
            contextId,
            preferredContextId,
        });
    }
}
