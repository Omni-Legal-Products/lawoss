export function preflight(env: NodeJS.ProcessEnv): void;
export function control(command: string, directory?: string, env?: NodeJS.ProcessEnv): Promise<void>;
