export interface DaemonStatus {
    ok: boolean;
    pid: number;
    uptime: number;
    daemonVersion?: string;
    extensionConnected: boolean;
    extensionVersion?: string;
    extensionCompatRange?: string;
    contextId?: string;
    profileRequired?: boolean;
    profileDisconnected?: boolean;
    profiles?: BrowserProfileStatus[];
    pending: number;
    commandResultUnknown?: number;
    memoryMB: number;
    port: number;
}
export interface BrowserProfileStatus {
    contextId: string;
    extensionConnected: boolean;
    extensionVersion?: string;
    extensionCompatRange?: string;
    pending: number;
    lastSeenAt?: number;
}
export type DaemonHealth = {
    state: 'stopped';
    status: null;
} | {
    state: 'no-extension';
    status: DaemonStatus;
} | {
    state: 'profile-required';
    status: DaemonStatus;
} | {
    state: 'profile-disconnected';
    status: DaemonStatus;
} | {
    state: 'ready';
    status: DaemonStatus;
};
export declare function requestDaemon(pathname: string, init?: RequestInit & {
    timeout?: number;
}): Promise<Response>;
export declare function fetchDaemonStatus(opts?: {
    timeout?: number;
    contextId?: string;
    preferredContextId?: string;
}): Promise<DaemonStatus | null>;
export declare function getDaemonHealth(opts?: {
    timeout?: number;
    contextId?: string;
    preferredContextId?: string;
}): Promise<DaemonHealth>;
export declare function requestDaemonShutdown(opts?: {
    timeout?: number;
}): Promise<boolean>;
