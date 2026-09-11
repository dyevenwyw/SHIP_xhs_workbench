import type { DaemonHealth } from './daemon-transport.js';
export type { DaemonHealth };
export type HealthFetcher = (opts?: {
    timeout?: number;
    contextId?: string;
    preferredContextId?: string;
}) => Promise<DaemonHealth>;
export declare function waitForBridgeReady(fetchHealth: HealthFetcher, opts: {
    timeoutMs: number;
    contextId?: string;
    preferredContextId?: string;
    intervalMs?: number;
}): Promise<DaemonHealth>;
export declare const PRE_DISPATCH_ERROR_CODES: Set<"profile_disconnected" | "extension_not_connected">;
export declare function isPreDispatchError(errorCode: string | undefined): boolean;
