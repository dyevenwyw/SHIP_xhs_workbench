/**
 * CLI commands for daemon lifecycle:
 *   opencli daemon status — show daemon state
 *   opencli daemon stop   — graceful shutdown
 *   opencli daemon restart — graceful shutdown, then start a fresh daemon
 */
export declare function daemonStatus(): Promise<void>;
export declare function daemonStop(): Promise<void>;
export declare function daemonRestart(): Promise<void>;
