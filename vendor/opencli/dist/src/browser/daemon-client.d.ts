/**
 * HTTP client for communicating with the opencli daemon.
 *
 * Provides a typed send() function that posts a Command and returns a Result.
 */
import { fetchDaemonStatus, getDaemonHealth, requestDaemonShutdown, type BrowserProfileStatus, type DaemonHealth, type DaemonStatus } from './daemon-transport.js';
/**
 * Id for a whole logical CLI command run. Encodes the CLI pid so the daemon can
 * name/kill the holder in a busy error (see parsePidFromRunId in session-lease.ts).
 */
export declare function generateRunId(): string;
/**
 * Identity of the CLI command run currently driving the browser, attached to
 * every command so the daemon can arbitrate the write lease. Module-level and
 * one-per-invocation, matching `setDaemonCommandTimeoutSeconds`. Null for read
 * and ephemeral commands, which are never lease-arbitrated.
 */
export interface DaemonRunContext {
    runId: string;
    command: string;
    access: 'read' | 'write';
}
export declare function setDaemonRunContext(ctx: DaemonRunContext | null): void;
/**
 * Clear the run context only if it still belongs to `runId`. Used by deferred
 * cleanup (an adapter that outlived its CLI timeout settles later): by then a
 * newer run may own the context, and unconditionally nulling it would strip
 * that run's lease heartbeats mid-flight.
 */
export declare function clearDaemonRunContext(runId: string): void;
/**
 * Best-effort release of a persistent site-session lease on command completion.
 * A direct one-shot POST (no bridge ensure / retry): if it never lands, the
 * daemon's TTL reclaims the lease anyway, so this must never block the caller.
 */
export declare function releaseSiteSessionLease(params: {
    runId: string;
    session: string;
    surface: 'adapter';
}): Promise<void>;
/**
 * Propagate the user's `--timeout` down to the transport layer. Without this
 * the daemon/HTTP deadlines stay at their defaults and a long-running command
 * gets aborted mid-flight even though the user explicitly allowed more time.
 */
export declare function setDaemonCommandTimeoutSeconds(seconds: number | null): void;
/**
 * True when a thrown error carries an unknown-outcome code — the browser-side
 * command may still be running even though the client gave up. Callers use this
 * to decide whether it is safe to release a persistent site-session lease: it is
 * not, because the still-running command keeps mutating the tab. Walks the cause
 * chain so a wrapped `BrowserCommandError` is still recognized.
 */
export declare function isUnknownOutcomeError(err: unknown): boolean;
export interface DaemonCommand {
    id: string;
    action: 'exec' | 'navigate' | 'tabs' | 'cookies' | 'screenshot' | 'close-window' | 'set-file-input' | 'insert-text' | 'bind' | 'network-capture-start' | 'network-capture-read' | 'wait-download' | 'cdp' | 'frames' | 'lease-release';
    /** Target page identity (targetId). Cross-layer contract with the extension. */
    page?: string;
    code?: string;
    session?: string;
    surface?: 'browser' | 'adapter';
    /** Adapter site session lifecycle. Persistent site sessions do not idle-expire. */
    siteSession?: 'ephemeral' | 'persistent';
    url?: string;
    op?: string;
    index?: number;
    domain?: string;
    format?: 'png' | 'jpeg';
    quality?: number;
    fullPage?: boolean;
    /** Override viewport width in CSS pixels for screenshot (0 / undefined = use current) */
    width?: number;
    /** Override viewport height in CSS pixels for screenshot (0 / undefined = use current; ignored when fullPage) */
    height?: number;
    /** Local file paths for set-file-input action */
    files?: string[];
    /** CSS selector for file input element (set-file-input action) */
    selector?: string;
    /** Raw text payload for insert-text action */
    text?: string;
    /** URL substring filter pattern for network capture */
    pattern?: string;
    /** Download wait timeout in milliseconds */
    timeoutMs?: number;
    cdpMethod?: string;
    cdpParams?: Record<string, unknown>;
    /** Window foreground/background policy for owned Browser Bridge containers. */
    windowMode?: 'foreground' | 'background';
    /** Custom idle timeout in seconds for this session. Overrides the default. */
    idleTimeout?: number;
    /** Frame index for cross-frame operations (0-based, from 'frames' action) */
    frameIndex?: number;
    /** Browser profile/context REQUIRED for this command (--profile / OPENCLI_PROFILE). Fails loud when offline. */
    contextId?: string;
    /**
     * Browser profile/context PREFERRED for this command (persisted config
     * default). The daemon uses it when connected, and falls back to the only
     * connected profile when it is not — a stale default must never veto live
     * reality. Mutually exclusive with `contextId`.
     */
    preferredContextId?: string;
    /**
     * Daemon-side command timeout in seconds. Set by the transport layer from
     * the effective command deadline; kept for older daemons — new code prefers
     * `deadlineAt`.
     */
    timeout?: number;
    /**
     * Absolute command deadline (epoch ms). All hops run on one machine, so
     * every layer derives its remaining budget as `deadlineAt - Date.now()`,
     * absorbing queueing and service-worker wake latency.
     */
    deadlineAt?: number;
    /**
     * Stable id for the whole logical CLI command run (NOT the per-exec `id`).
     * The daemon uses it to arbitrate a write lease on the persistent site
     * session: the first command acquires, same-runId execs refresh it as a
     * heartbeat, a concurrent different-runId write fails fast. See session-lease.ts.
     */
    runId?: string;
    /** Human command name (e.g. `chatgpt ask`) surfaced in the busy error. */
    command?: string;
    /** Command access level; only 'write' commands take/hold a session lease. */
    access?: 'read' | 'write';
}
export interface DaemonResult {
    id: string;
    ok: boolean;
    data?: unknown;
    error?: string;
    errorCode?: string;
    errorHint?: string;
    /** Page identity (targetId) — present on page-scoped command responses */
    page?: string;
}
export declare class BrowserCommandError extends Error {
    readonly code?: string | undefined;
    readonly hint?: string | undefined;
    constructor(message: string, code?: string | undefined, hint?: string | undefined);
}
export { fetchDaemonStatus, getDaemonHealth, requestDaemonShutdown, type BrowserProfileStatus, type DaemonHealth, type DaemonStatus, };
/**
 * Send a command to the daemon and return the result data.
 */
export declare function sendCommand(action: DaemonCommand['action'], params?: Omit<DaemonCommand, 'id' | 'action'>): Promise<unknown>;
/**
 * Like sendCommand, but returns both data and page identity (targetId).
 * Use this for page-scoped commands where the caller needs the page identity.
 */
export declare function sendCommandFull(action: DaemonCommand['action'], params?: Omit<DaemonCommand, 'id' | 'action'>): Promise<{
    data: unknown;
    page?: string;
}>;
export declare function bindTab(session: string, opts?: {
    contextId?: string;
}): Promise<unknown>;
