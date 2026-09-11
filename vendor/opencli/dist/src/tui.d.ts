/**
 * Simple yes/no confirmation prompt.
 *
 * In non-TTY environments, returns `defaultYes` (defaults to true) without blocking.
 * In TTY, waits for a single keypress: y/Enter → true, n/Esc/q → false.
 */
export declare function confirmPrompt(message: string, defaultYes?: boolean): Promise<boolean>;
