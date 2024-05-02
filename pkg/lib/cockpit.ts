import cockpit_core from './cockpit-core';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = Record<string, JsonValue>;

export interface BasicError {
    problem: string;
    message: string;
    toString(): string;
}

/* === jQuery compatible promise ============== */

interface DeferredPromise<T> extends Promise<T> {
    /* jQuery Promise compatibility */
    done(callback: (data: T) => void): DeferredPromise<T>
    fail(callback: (exc: Error) => void): DeferredPromise<T>
    always(callback: () => void): DeferredPromise<T>
    progress(callback: (message: T, cancel: () => void) => void): DeferredPromise<T>
}

interface Deferred<T> {
    resolve(): Deferred<T>;
    reject(): Deferred<T>;
    notify(): Deferred<T>;
    promise: DeferredPromise<T>
}

/* === Events mix-in ========================= */

export interface EventMap {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [_: string]: (...args: any[]) => void;
}

export type EventListener<E extends (...args: unknown[]) => void> =
    (event: CustomEvent<Parameters<E>>, ...args: Parameters<E>) => void;

export interface EventSource<EM extends EventMap> {
    addEventListener<E extends keyof EM>(event: E, listener: EventListener<EM[E]>): void;
    removeEventListener<E extends keyof EM>(event: E, listener: EventListener<EM[E]>): void;
    dispatchEvent<E extends keyof EM>(event: E, ...args: Parameters<EM[E]>): void;
}

interface CockpitEvents extends EventMap {
    locationchanged(): void;
    visibilitychange(): void;
}

/* === Channel =============================== */

interface ControlMessage extends JsonObject {
    command: string;
}

interface ChannelEvents<T> extends EventMap {
    control(options: JsonObject): void;
    ready(options: JsonObject): void;
    close(options: JsonObject): void;
    message(data: T): void;
}

interface Channel<T> extends EventSource<ChannelEvents<T>> {
    id: string | null;
    binary: boolean;
    options: JsonObject;
    ready: boolean;
    valid: boolean;
    send(data: T): void;
    control(options: ControlMessage): void;
    wait(): Promise<void>;
    close(options?: JsonObject): void;
}

interface ChannelOptions {
    payload: string;
    superuser?: "try" | "require";
    [_: string]: JsonValue | undefined;
}

/* === cockpit.spawn ============================= */

interface Spawn<T> extends DeferredPromise<T> {
    input(message: T, stream?: boolean): DeferredPromise<T>;
    stream(callback: (data: T) => void): DeferredPromise<T>;
    close(): void;
}

interface SpawnOptions {
    binary?: boolean,
    directory?: string;
    err?: "out" | "ignore" | "message";
    environ?: string[];
    pty?: boolean;
    superuser?: "try" | "require";
}

/* === cockpit.location ========================== */

interface Location {
    url_root: string;
    options: { [name: string]: string | Array<string> };
    path: Array<string>;
    href: string;
    go(path: Location | string, options?: { [key: string]: string }): void;
    replace(path: Location | string, options?: { [key: string]: string }): void;
}

/* === cockpit.dbus ========================== */

interface DBusProxyEvents extends EventMap {
    changed(changes: { [property: string]: unknown }): void;
}

interface DBusProxy extends EventSource<DBusProxyEvents> {
    valid: boolean;
    [property: string]: unknown;
}

interface DBusOptions {
    bus?: string;
    address?: string;
    superuser?: "require" | "try";
    track?: boolean;
}

interface DBusClient {
    readonly unique_name: string;
    readonly options: DBusOptions;
    proxy(iface: string, path: string, options?: { watch?: boolean }): DBusProxy;
    close(): void;
}

type VariantType = string | Uint8Array | number | boolean | VariantType[];
interface Variant {
    t: string;
    v: VariantType;
}

/* === cockpit.file ========================== */

interface FileSyntaxObject<T, B> {
    parse(content: B): T;
    stringify(content: T): B;
}

type FileTag = string;

type FileWatchCallback<T> = (data: T | null, tag: FileTag | null, error: BasicError | null) => void;
interface FileWatchHandle {
    remove(): void;
}

interface FileHandle<T> {
    read(): Promise<T>;
    replace(content: T): Promise<FileTag>;
    watch(callback: FileWatchCallback<T>, options?: { read?: boolean }): FileWatchHandle;
    modify(callback: (data: T) => T): Promise<[T, FileTag]>;
    close(): void;
    path: string;
}

type FileOpenOptions = {
    max_read_size?: number;
    superuser?: string;
};

/* === cockpit.user ========================== */

export type UserInfo = {
    id: number;
    name: string;
    full_name: string;
    groups: Array<string>;
    home: string;
    shell: string;
};

type FormatOptions = {
    precision?: number;
    base2?: boolean;
};

type MaybeNumber = number | null | undefined;

interface Cockpit extends EventSource<CockpitEvents> {
    assert(predicate: unknown, message?: string): asserts predicate;
    language: string;
    location: Location;
    channel(options: ChannelOptions & { binary?: false; }): Channel<string>;
    channel(options: ChannelOptions & { binary: true; }): Channel<Uint8Array>;
    defer<T>(): Deferred<T>;

    spawn(
        args: string[],
        options?: SpawnOptions & { binary?: false }
    ): Spawn<string>;
    spawn(
        args: string[],
        options: SpawnOptions & { binary: true }
    ): Spawn<Uint8Array>;

    dbus(name: string | null, options?: DBusOptions): DBusClient;

    variant(type: string, value: VariantType): Variant;
    byte_array(string: string): string;

    file(
        path: string,
        options?: FileOpenOptions & { binary?: false; syntax?: undefined; }
    ): FileHandle<string>;
    file(
        path: string,
        options: FileOpenOptions & { binary: true; syntax?: undefined; }
    ): FileHandle<Uint8Array>;
    file<T>(
        path: string,
        options: FileOpenOptions & { binary?: false; syntax: FileSyntaxObject<T, string>; }
    ): FileHandle<T>;
    file<T>(
        path: string,
        options: FileOpenOptions & { binary: true; syntax: FileSyntaxObject<T, Uint8Array>; }
    ): FileHandle<T>;

    user(): Promise<UserInfo>;

    /* === String helpers ======================== */
    message(problem: string | JsonObject): string;
    gettext(message: string): string;
    gettext(context: string, message?: string): string;
    ngettext(message1: string, messageN: string, n: number): string;
    ngettext(context: string, message1: string, messageN: string, n: number): string;

    format(format_string: string, ...args: unknown[]): string;

    /* === Number formatting ===================== */
    format_number(n: MaybeNumber, precision?: number): string
    format_bytes(n: MaybeNumber, options?: FormatOptions): string;
    format_bytes_per_sec(n: MaybeNumber, options?: FormatOptions): string;
    format_bits_per_sec(n: MaybeNumber, options?: FormatOptions & { base2?: false }): string;
    /** @deprecated */ format_bytes(n: MaybeNumber, factor: unknown, options?: object | boolean): string | string[];
    /** @deprecated */ format_bytes_per_sec(n: MaybeNumber, factor: unknown, options?: object | boolean): string | string[];
    /** @deprecated */ format_bits_per_sec(n: MaybeNumber, factor: unknown, options?: object | boolean): string | string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cockpit: Cockpit = cockpit_core as any;
export default cockpit;
