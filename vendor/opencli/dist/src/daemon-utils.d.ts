export declare const COMMAND_RESULT_UNKNOWN_CODE = "command_result_unknown";
export declare const COMMAND_RESULT_UNKNOWN_HINT = "Inspect the browser/session state before retrying. Do not blindly retry write commands such as navigate, click, type, or eval.";
export declare const PROFILE_DISCONNECTED_HINT = "Open that Chrome profile and make sure the OpenCLI extension is enabled, or choose another profile with opencli profile use <name>.";
export type DaemonFailureContract = {
    message: string;
    errorCode: string;
    errorHint: string;
    status: number;
    countAsCommandResultUnknown: boolean;
};
export declare function commandResultUnknownMessage(action: string): string;
export declare function buildExtensionDisconnectFailure(input: {
    contextId: string;
    action: string;
    dispatched: boolean;
}): DaemonFailureContract;
export type ProfileRouteInput = {
    /** Hard requirement (--profile / OPENCLI_PROFILE) — never falls back. */
    requestedContextId?: string;
    /** Soft preference (config defaultContextId) — arbitrated against live state. */
    preferredContextId?: string;
    /** contextIds of currently connected extension profiles. */
    connectedContextIds: string[];
};
export type ProfileRouteResult = {
    ok: true;
    contextId: string; /** set when a stale preference was overridden by the only live profile */
    fallbackFrom?: string;
} | {
    ok: false;
    errorCode: 'profile_disconnected' | 'profile_required' | 'extension_not_connected';
    error: string;
    errorHint?: string;
};
/**
 * Decide which extension profile serves a command. The arbiter lives with the
 * daemon because the daemon is the only component that knows live connections:
 * a REQUIREMENT fails loud when offline, a PREFERENCE falls back to the only
 * connected profile — which keeps the documented promise "with only one
 * connected profile, OpenCLI uses it automatically" true even when a persisted
 * default outlives the extension instance it names.
 */
export declare function resolveProfileRoute(input: ProfileRouteInput): ProfileRouteResult;
export declare function buildCommandTimeoutFailure(action: string, timeoutMs: number): DaemonFailureContract;
export declare function buildCommandDispatchFailure(contextId: string): DaemonFailureContract;
export declare function getResponseCorsHeaders(pathname: string, origin?: string): Record<string, string> | undefined;
