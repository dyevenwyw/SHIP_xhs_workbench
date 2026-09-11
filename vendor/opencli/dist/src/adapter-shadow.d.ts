export type AdapterShadow = {
    name: string;
    userPath: string;
    builtinPath: string;
};
export type AdapterShadowOptions = {
    userClisDir?: string;
    builtinClisDir?: string;
};
export declare function findShadowedUserAdapters(opts?: AdapterShadowOptions): AdapterShadow[];
export declare function formatAdapterShadowIssue(shadows: AdapterShadow[]): string;
