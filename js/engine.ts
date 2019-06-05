import { Go } from "./wasm_exec";
import { Program } from "./program";
import { Compiler } from "./compiler";

export class Engine {
  private readonly __go: Go;
  private readonly __compiler: Compiler;
  private readonly __version: string;

  constructor(go: Go) {
    this.__go = go;
    this.__compiler = go.platform.ferret;
    this.__version = this.__compiler.version();
  }

  public version(): string {
    return this.__version;
  }

  public compile(query: string): Program {
    const res = this.__compiler.compile(query);

    if (!res.ok) {
      throw new Error(res.error);
    }

    return new Program(this.__compiler, res.data as string);
  }

  public exec<T>(query: string, args?: any): T {
    const res = this.__compiler.exec(query, args);

    if (res.ok) {
      return res.data as T;
    }

    throw new Error(res.error);
  }
}
