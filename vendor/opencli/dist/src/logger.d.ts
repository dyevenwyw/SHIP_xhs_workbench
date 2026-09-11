/**
 * Unified logging for opencli.
 *
 * All framework output (warnings, debug info, errors) should go through
 * this module so that verbosity levels are respected consistently.
 */
export declare const log: {
    /** Informational message (always shown) */
    info(msg: string): void;
    /** Lightweight status line for adapter progress updates */
    status(msg: string): void;
    /** Positive completion/status line without the heavier info prefix */
    success(msg: string): void;
    /** Warning (always shown) */
    warn(msg: string): void;
    /** Error (always shown) */
    error(msg: string): void;
    /** Verbose output (shown when -v flag or OPENCLI_VERBOSE is set) */
    verbose(msg: string): void;
    /** Alias for verbose output. */
    debug(msg: string): void;
    /** Step-style debug (for pipeline steps, etc.) */
    step(stepNum: number, total: number, op: string, preview?: string): void;
    /** Step result summary */
    stepResult(summary: string): void;
};
