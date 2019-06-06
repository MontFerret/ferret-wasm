export interface Version {
    self: string;
    ferret: string;
}

export interface CompilerResult<T = any> {
    ok: boolean;
    data?: T;
    error?: string;
}

export type CompilerCallback<T> = (err?: string, data?: T) => void;

export interface Compiler {
    version(): CompilerResult<Version>;
    compile(query: string): CompilerResult<string>;
    run<T>(
        id: string,
        args: object,
        cb: CompilerCallback<T>,
    ): CompilerResult<void>;
    exec<T>(
        query: string,
        args: object,
        cb: CompilerCallback<T>,
    ): CompilerResult<void>;
}

export function createCallback<T>(
    resolve: (data: T) => void,
    reject: (err: Error) => void,
): CompilerCallback<T> {
    return (err?: string, data?: any) => {
        if (err != null) {
            return reject(new Error(err));
        }

        return resolve(data);
    };
}
