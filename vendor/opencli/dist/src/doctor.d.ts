/**
 * opencli doctor — diagnose browser connectivity.
 *
 * Simplified for the daemon-based architecture.
 */
import type { BrowserProfileStatus } from './browser/daemon-transport.js';
import { type AdapterShadow } from './adapter-shadow.js';
export type DoctorOptions = {
    yes?: boolean;
    cliVersion?: string;
};
export type ConnectivityResult = {
    ok: boolean;
    error?: string;
    durationMs: number;
};
export type DoctorReport = {
    cliVersion?: string;
    daemonRunning: boolean;
    daemonFlaky?: boolean;
    daemonStale?: boolean;
    daemonVersion?: string;
    extensionConnected: boolean;
    extensionFlaky?: boolean;
    extensionVersion?: string;
    latestExtensionVersion?: string;
    connectivity?: ConnectivityResult;
    profiles?: BrowserProfileStatus[];
    adapterShadows?: AdapterShadow[];
    issues: string[];
};
/**
 * Test connectivity with a daemon-to-extension command that does not resolve a
 * page or create a Browser Bridge container window.
 */
export declare function checkConnectivity(opts?: {
    timeout?: number;
}): Promise<ConnectivityResult>;
export declare function runBrowserDoctor(opts?: DoctorOptions): Promise<DoctorReport>;
export declare function renderBrowserDoctorReport(report: DoctorReport): string;
