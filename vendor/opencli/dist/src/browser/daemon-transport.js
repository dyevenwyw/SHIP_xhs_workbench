import { DEFAULT_DAEMON_PORT, isIgnorableDaemonPortEnv, unsupportedDaemonPortEnvMessage } from '../constants.js';
const DAEMON_PORT = DEFAULT_DAEMON_PORT;
const DAEMON_URL = `http://127.0.0.1:${DAEMON_PORT}`;
const OPENCLI_HEADERS = { 'X-OpenCLI': '1' };
class UnsupportedDaemonPortEnvError extends Error {
    constructor(value) {
        super(unsupportedDaemonPortEnvMessage(value));
        this.name = 'UnsupportedDaemonPortEnvError';
    }
}
function assertSupportedDaemonPortEnv() {
    const value = process.env.OPENCLI_DAEMON_PORT;
    if (!isIgnorableDaemonPortEnv(value))
        throw new UnsupportedDaemonPortEnvError(value);
}
export async function requestDaemon(pathname, init) {
    assertSupportedDaemonPortEnv();
    const { timeout = 2000, headers, ...rest } = init ?? {};
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        return await fetch(`${DAEMON_URL}${pathname}`, {
            ...rest,
            headers: { ...OPENCLI_HEADERS, ...headers },
            signal: controller.signal,
        });
    }
    finally {
        clearTimeout(timer);
    }
}
export async function fetchDaemonStatus(opts) {
    try {
        const query = new URLSearchParams({
            ...(opts?.contextId ? { contextId: opts.contextId } : {}),
            ...(opts?.preferredContextId ? { preferredContextId: opts.preferredContextId } : {}),
        }).toString();
        const res = await requestDaemon(`/status${query ? `?${query}` : ''}`, { timeout: opts?.timeout ?? 2000 });
        if (!res.ok)
            return null;
        return await res.json();
    }
    catch (err) {
        if (err instanceof UnsupportedDaemonPortEnvError)
            throw err;
        return null;
    }
}
export async function getDaemonHealth(opts) {
    const status = await fetchDaemonStatus(opts);
    if (!status)
        return { state: 'stopped', status: null };
    if (status.profileRequired)
        return { state: 'profile-required', status };
    if (status.profileDisconnected)
        return { state: 'profile-disconnected', status };
    if (!status.extensionConnected)
        return { state: 'no-extension', status };
    return { state: 'ready', status };
}
export async function requestDaemonShutdown(opts) {
    try {
        const res = await requestDaemon('/shutdown', { method: 'POST', timeout: opts?.timeout ?? 5000 });
        return res.ok;
    }
    catch (err) {
        if (err instanceof UnsupportedDaemonPortEnvError)
            throw err;
        return false;
    }
}
