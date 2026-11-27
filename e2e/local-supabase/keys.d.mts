export declare const JWT_SECRET: string;
export declare const ANON_KEY: string;
export declare const SERVICE_KEY: string;
export declare function signJwt(payload: Record<string, unknown>): string;
export declare function verifyJwt(token: string | undefined): Record<string, unknown> | null;
