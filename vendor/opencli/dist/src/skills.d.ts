export interface OpenCliSkillInfo {
    name: string;
    description: string;
    version: string;
    path: string;
}
export interface OpenCliSkillReadResult {
    skill: string;
    path: string;
    content: string;
}
export declare function getSkillsRoot(packageRoot?: string): string;
export declare function listOpenCliSkills(packageRoot?: string): OpenCliSkillInfo[];
export declare function readOpenCliSkill(target: string, relpath?: string, packageRoot?: string): OpenCliSkillReadResult;
