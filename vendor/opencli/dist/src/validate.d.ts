export interface CommandValidationResult {
    /** Display label: "site/name" or source path if available */
    label: string;
    errors: string[];
    warnings: string[];
}
export interface ValidationReport {
    ok: boolean;
    results: CommandValidationResult[];
    errors: number;
    warnings: number;
    commands: number;
}
/**
 * Validate registered CLI commands from the in-memory registry.
 */
export declare function validateClisWithTarget(target?: string): ValidationReport;
export declare function renderValidationReport(report: ValidationReport): string;
