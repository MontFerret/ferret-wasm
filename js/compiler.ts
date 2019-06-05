interface CompilerResult<T = any> {
    ok: boolean;
    data?: T;
    error?: string;
}

export interface Compiler {
    version(): string;
    compile(query: string): CompilerResult<string>;
    run<T>(id: string, args?: any): CompilerResult<T>;
    exec<T>(query: string, args?: any): CompilerResult<T>;
}
