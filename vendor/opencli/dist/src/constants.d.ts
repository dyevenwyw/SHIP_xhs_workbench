/**
 * Shared constants used across explore, synthesize, and pipeline modules.
 */
/** Default daemon port for HTTP/WebSocket communication with browser extension */
export declare const DEFAULT_DAEMON_PORT = 19825;
export declare function unsupportedDaemonPortEnvMessage(value?: string): string;
/**
 * True when OPENCLI_DAEMON_PORT carries no real configuration: unset, empty,
 * or equal to the default port. Launchers (notably OpenCLIApp) inject the
 * variable with the default value into every CLI they manage — rejecting that
 * harmless redundancy bricked all commands on fresh installs (#2068). Only a
 * NON-default value is a genuine misconfiguration worth failing on.
 */
export declare function isIgnorableDaemonPortEnv(value: string | undefined): boolean;
