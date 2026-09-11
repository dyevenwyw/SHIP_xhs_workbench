import { describe, expect, it, vi } from 'vitest';
import { PRE_DISPATCH_ERROR_CODES, isPreDispatchError, waitForBridgeReady, } from './bridge-readiness.js';
function status(extensionConnected) {
    return {
        ok: true,
        pid: 1,
        uptime: 0,
        extensionConnected,
        pending: 0,
        memoryMB: 0,
        port: 19825,
    };
}
function readyHealth() {
    return { state: 'ready', status: status(true) };
}
function notReadyHealth(state) {
    if (state === 'stopped')
        return { state: 'stopped', status: null };
    return { state, status: status(false) };
}
describe('waitForBridgeReady', () => {
    it('returns immediately on the first ready health', async () => {
        const fetchHealth = vi.fn(async () => readyHealth());
        const result = await waitForBridgeReady(fetchHealth, { timeoutMs: 10_000, intervalMs: 1 });
        expect(result.state).toBe('ready');
        expect(fetchHealth).toHaveBeenCalledTimes(1);
    });
    it('polls until ready when initial reads are not ready', async () => {
        const sequence = [
            notReadyHealth('stopped'),
            notReadyHealth('no-extension'),
            readyHealth(),
        ];
        let i = 0;
        const fetchHealth = vi.fn(async () => sequence[i++] ?? readyHealth());
        const result = await waitForBridgeReady(fetchHealth, { timeoutMs: 10_000, intervalMs: 1 });
        expect(result.state).toBe('ready');
        expect(fetchHealth).toHaveBeenCalledTimes(3);
    });
    it('forwards preferredContextId to every health poll', async () => {
        const sequence = [notReadyHealth('profile-required'), readyHealth()];
        let i = 0;
        const fetchHealth = vi.fn(async () => sequence[i++] ?? readyHealth());
        await waitForBridgeReady(fetchHealth, { timeoutMs: 10_000, intervalMs: 1, preferredContextId: 'zvypsyje' });
        expect(vi.mocked(fetchHealth).mock.calls.length).toBeGreaterThan(1);
        for (const call of vi.mocked(fetchHealth).mock.calls) {
            expect(call[0]).toMatchObject({ preferredContextId: 'zvypsyje' });
        }
    });
    it('returns the last observed non-ready health when the deadline expires', async () => {
        const fetchHealth = vi.fn(async () => notReadyHealth('profile-disconnected'));
        const result = await waitForBridgeReady(fetchHealth, { timeoutMs: 25, intervalMs: 5 });
        expect(result.state).toBe('profile-disconnected');
        expect(vi.mocked(fetchHealth).mock.calls.length).toBeGreaterThan(1);
    });
});
describe('isPreDispatchError', () => {
    it('classifies only safe pre-dispatch daemon errors', () => {
        expect(isPreDispatchError('extension_not_connected')).toBe(true);
        expect(isPreDispatchError('profile_disconnected')).toBe(true);
        expect(isPreDispatchError('profile_required')).toBe(false);
        expect(isPreDispatchError('command_result_unknown')).toBe(false);
        expect(isPreDispatchError(undefined)).toBe(false);
        expect(PRE_DISPATCH_ERROR_CODES.size).toBe(2);
    });
});
