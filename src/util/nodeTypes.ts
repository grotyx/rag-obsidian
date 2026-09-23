/**
 * Minimal local stand-ins for the slice of the Node.js API that
 * `src/index/localFiles.ts`, `src/llm/cli.ts`, `src/mcp/bridge.ts`, `src/mcp/http.ts` and
 * `src/write/docx.ts` actually call. `@types/node` normally supplies these, but the Obsidian
 * Community review's lint environment doesn't have it resolved, so those five files use these
 * instead (see `tsconfig.json`'s `"types": []`, which reproduces that environment locally).
 * Every interface here covers only the members those five files use — narrow on purpose; widen a
 * member (never add an unused one) if a new call site needs it.
 */

declare const require: (id: string) => unknown;

/** Cast one `require("node:...")` result to `T` in a single place. */
export function nodeRequire<T>(id: string): T {
  return require(id) as T;
}

export type ProcessEnv = Record<string, string | undefined>;

// -- process / Buffer ----------------------------------------------------------------------
// Real Node/Electron already provides both as globals at runtime; only their types are missing.
// Declared globally (once, for the whole program) rather than imported, so `src/mcp/bridge.ts` —
// whose `bridgeMain` function body is extracted via `.toString()` and run standalone — can keep
// referencing bare `process`/`Buffer` with no import inside that function.
declare global {
  interface NodeProcessLike {
    readonly platform: string;
    readonly env: ProcessEnv;
    readonly argv: string[];
    readonly pid: number;
    readonly stdin: unknown;
    readonly stdout: { write(chunk: string): void };
    readonly stderr: { write(chunk: string): void };
    exit(code?: number): never;
    getuid?: () => number;
  }
  const process: NodeProcessLike;

  interface Buffer {
    readonly length: number;
    readonly buffer: ArrayBufferLike;
    readonly byteOffset: number;
    readonly byteLength: number;
    toString(encoding?: string): string;
  }
  interface BufferConstructor {
    from(data: ArrayBuffer | Uint8Array | string, encodingOrOffset?: string | number): Buffer;
    byteLength(input: string | Buffer): number;
  }
  const Buffer: BufferConstructor;
}

// -- fs / fs/promises ------------------------------------------------------------------------

export interface StatsLike {
  uid: number;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface FsPromisesLike {
  readFile(path: string, encoding: string): Promise<string>;
  readFile(path: string): Promise<Buffer>;
  writeFile(
    path: string,
    data: string | Buffer | Uint8Array,
    options?: string | { mode?: number; flag?: string }
  ): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  stat(path: string): Promise<StatsLike>;
  lstat(path: string): Promise<StatsLike>;
  mkdtemp(prefix: string): Promise<string>;
  access(path: string): Promise<void>;
  realpath(path: string): Promise<string>;
  unlink(path: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
}

export interface FsSyncLike {
  existsSync(path: string): boolean;
  realpathSync: ((path: string) => string) & { native(path: string): string };
  statSync(path: string): { uid: number };
  readFileSync(path: string, encoding: string): string;
}

// -- os / path --------------------------------------------------------------------------------

export interface OsModuleLike {
  homedir(): string;
  tmpdir(): string;
}

export interface PathModuleLike {
  join(...parts: string[]): string;
  dirname(p: string): string;
  resolve(...parts: string[]): string;
  relative(from: string, to: string): string;
  isAbsolute(p: string): boolean;
  readonly sep: string;
  readonly delimiter: string;
}

// -- crypto -------------------------------------------------------------------------------------

export interface HashLike {
  update(data: string): HashLike;
  digest(encoding: string): string;
}

export interface CryptoModuleLike {
  createHash(algorithm: string): HashLike;
  randomBytes(size: number): Buffer;
  timingSafeEqual(a: Buffer, b: Buffer): boolean;
}

// -- child_process --------------------------------------------------------------------------

export interface ReadableStreamLike {
  on(event: "data", listener: (chunk: Buffer) => void): void;
}

export interface WritableStreamLike {
  on(event: "error", listener: (err: Error) => void): void;
  write(chunk: string): void;
  end(): void;
}

/** Covers both `spawn`'s long-lived handle and the plain object `execFile` hands its callback. */
export interface ChildProcessLike {
  stdout: ReadableStreamLike | null;
  stderr: ReadableStreamLike | null;
  stdin: WritableStreamLike | null;
  kill(): void;
  on(event: "error", listener: (err: Error) => void): void;
  on(event: "close", listener: (code: number | null) => void): void;
}

export interface SpawnOptionsLike {
  cwd?: string;
  env?: ProcessEnv;
  shell?: boolean;
  stdio?: string[];
}

export interface ExecFileOptionsLike {
  timeout?: number;
  cwd?: string;
}

export interface ChildProcessModuleLike {
  spawn(command: string, args: string[], options: SpawnOptionsLike): ChildProcessLike;
  execFile(
    file: string,
    args: string[],
    options: ExecFileOptionsLike,
    callback: (error: Error | null, stdout: Buffer, stderr: Buffer) => void
  ): void;
}

// -- http -------------------------------------------------------------------------------------

export interface IncomingMessageLike {
  // Node types `host`/`authorization` (and most other headers) as always-single-valued, unlike
  // the general index signature — match that so callers can pass them straight to a
  // `string | undefined` parameter without a cast.
  headers: {
    host?: string;
    authorization?: string;
    "content-type"?: string;
    [key: string]: string | string[] | undefined;
  };
  socket: { remoteAddress?: string };
  method?: string;
  url?: string;
  setEncoding(encoding: string): void;
  on(event: "data", listener: (chunk: string) => void): void;
  on(event: "end", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
}

export interface ServerResponseLike {
  writeHead(statusCode: number, headers?: Record<string, string | number>): ServerResponseLike;
  end(body?: string): void;
}

export interface AddressInfoLike {
  port: number;
}

export interface ServerLike {
  requestTimeout: number;
  headersTimeout: number;
  maxHeadersCount: number;
  listen(port: number, host: string, callback: () => void): void;
  address(): AddressInfoLike | string | null;
  close(callback?: () => void): void;
  once(event: "error", listener: (err: Error) => void): void;
}

export interface ClientRequestLike {
  on(event: "timeout" | "error", listener: (err?: Error) => void): void;
  end(data?: string): void;
  destroy(err?: Error): void;
}

/** The exact shape `src/mcp/bridge.ts` already inline-types for `http.request`'s response
 *  callback — kept here only as the matching parameter type for `HttpModuleLike.request`. */
export interface HttpClientResponseLike {
  statusCode?: number;
  on(event: string, fn: (value?: Buffer) => void): void;
}

export interface HttpRequestOptionsLike {
  host: string;
  port: number;
  path: string;
  method: string;
  headers: Record<string, string | number>;
  timeout: number;
}

export interface HttpModuleLike {
  createServer(handler: (req: IncomingMessageLike, res: ServerResponseLike) => void): ServerLike;
  request(options: HttpRequestOptionsLike, callback: (res: HttpClientResponseLike) => void): ClientRequestLike;
}

// -- readline (bridge.ts only) ------------------------------------------------------------------

export interface ReadlineInterfaceLike {
  on(event: "line", listener: (line: string) => void): void;
}

export interface ReadlineModuleLike {
  createInterface(options: { input: unknown; crlfDelay: number }): ReadlineInterfaceLike;
}
