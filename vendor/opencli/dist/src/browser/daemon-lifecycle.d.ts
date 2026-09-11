import { type ChildProcess } from 'node:child_process';
import { DEFAULT_DAEMON_PORT } from '../constants.js';
import { requestDaemonShutdown, type DaemonHealth, type DaemonStatus } from './daemon-transport.js';
export interface DaemonLaunchSpec {
    binary: string;
    args: string[];
    scriptPath: string;
}
export interface DaemonRestartResult {
    previousStatus: DaemonStatus | null;
    status: DaemonStatus | null;
    stopped: boolean;
    spawned: boolean;
}
export declare function resolveDaemonLaunchSpec(): DaemonLaunchSpec;
export declare function spawnDaemonProcess(): ChildProcess;
export declare function waitForDaemonStop(timeoutMs: number): Promise<boolean>;
export declare function waitForDaemonStatus(timeoutMs: number): Promise<DaemonStatus | null>;
export declare const daemonLifecycleHooks: {
    requestDaemonShutdown: typeof requestDaemonShutdown;
    spawnDaemonProcess: typeof spawnDaemonProcess;
    waitForDaemonStop: typeof waitForDaemonStop;
};
export declare function restartDaemon(opts?: {
    stopTimeoutMs?: number;
    startTimeoutMs?: number;
}): Promise<DaemonRestartResult>;
export declare function ensureBrowserBridgeReady(opts?: {
    timeoutSeconds?: number;
    contextId?: string;
    preferredContextId?: string;
    verbose?: boolean;
}): Promise<DaemonHealth>;
export { DEFAULT_DAEMON_PORT };
