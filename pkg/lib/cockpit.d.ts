/* This file is part of Cockpit.
 *
 * Copyright (C) 2024 Red Hat, Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import '_internal/common'; // side-effecting import (`window` augmentations)
import type { Info } from './cockpit/_internal/info';

declare module 'cockpit' {
    type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
    type JsonObject = Record<string, JsonValue>;

    class BasicError {
        problem: string;
        message: string;
        toString(): string;
    }

    function init(): Promise<void>;

    function assert(predicate: unknown, message?: string): asserts predicate;

    export const manifests: { [package in string]?: JsonObject };
    export const info: Info;

    export let language: string;
    export let language_direction: string;

    interface Transport {
        csrf_token: string;
        origin: string;
        host: string;
        options: JsonObject;
        uri(suffix?: string): string;
        wait(callback: (transport: Transport) => void): void;
        close(problem?: string): void;
        application(): string;
        control(command: string, options: JsonObject): void;
    }

    export const transport: Transport;

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

    function defer<T>(): Deferred<T>;

    /* === Events mix-in ========================= */

    interface EventMap {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [_: string]: (...args: any[]) => void;
    }

    type EventListener<E extends (...args: unknown[]) => void> =
        (event: CustomEvent<Parameters<E>>, ...args: Parameters<E>) => void;

    interface EventSource<EM extends EventMap> {
        addEventListener<E extends keyof EM>(event: E, listener: EventListener<EM[E]>): void;
        removeEventListener<E extends keyof EM>(event: E, listener: EventListener<EM[E]>): void;
        dispatchEvent<E extends keyof EM>(event: E, ...args: Parameters<EM[E]>): void;
    }

    interface CockpitEvents extends EventMap {
        locationchanged(): void;
        visibilitychange(): void;
    }

    function addEventListener<E extends keyof CockpitEvents>(
        event: E, listener: EventListener<CockpitEvents[E]>
    ): void;
    function removeEventListener<E extends keyof CockpitEvents>(
        event: E, listener: EventListener<CockpitEvents[E]>
    ): void;

    interface ChangedEvents {
        changed(): void;
    }

    function event_target<T, EM extends EventMap>(obj: T): T & EventSource<EM>;

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
        wait(callback?: (data: T) => void): Promise<T>;
        close(options?: string | JsonObject): void;
    }

    // these apply to all channels
    interface ChannelOptions {
        superuser?: "try" | "require";
        [_: string]: JsonValue | undefined;
        binary?: boolean,

        // for remote channels
        host?: string;
        user?: string;
        password?: string;
        session?: "shared" | "private";
    }

    // this applies to opening a generic channel() with explicit payload
    interface ChannelOpenOptions extends ChannelOptions {
        payload: string;
    }

    function channel(options: ChannelOpenOptions & { binary?: false; }): Channel<string>;
    function channel(options: ChannelOpenOptions & { binary: true; }): Channel<Uint8Array>;

    /* === cockpit.{spawn,script} ============================= */

    class ProcessError {
        problem: string | null;
        exit_status: number | null;
        exit_signal: number | null;
        message: string;
    }

    interface Spawn<T> extends DeferredPromise<T> {
        input(message?: T | null, stream?: boolean): DeferredPromise<T>;
        stream(callback: (data: T) => void): DeferredPromise<T>;
        close(options?: string | JsonObject): void;
    }

    interface SpawnOptions extends ChannelOptions {
        directory?: string;
        err?: "out" | "ignore" | "message";
        environ?: string[];
        pty?: boolean;
    }

    function spawn(
        args: string[],
        options?: SpawnOptions & { binary?: false }
    ): Spawn<string>;
    function spawn(
        args: string[],
        options: SpawnOptions & { binary: true }
    ): Spawn<Uint8Array>;

    function script(
        script: string,
        args?: string[],
        options?: SpawnOptions & { binary?: false }
    ): Spawn<string>;
    function script(
        script: string,
        args?: string[],
        options?: SpawnOptions & { binary: true }
    ): Spawn<Uint8Array>;

    /* === cockpit.location ========================== */

    interface Location {
        url_root: string;
        options: { [name: string]: string | Array<string> };
        path: Array<string>;
        href: string;
        go(path: Location | string, options?: { [key: string]: string }): void;
        replace(path: Location | string, options?: { [key: string]: string }): void;

        encode(path: string[], options?: { [key: string]: string }, with_root?: boolean): string;
        decode(string: string, options?: { [key: string]: string }): string[];
    }

    export let location: Location;

    /* === cockpit.jump ========================== */

    function jump(path: string | string[], host?: string): void;

    /* === cockpit page visibility =============== */

    export let hidden: boolean;

    /* === cockpit.dbus ========================== */

    interface DBusProxyEvents extends EventMap {
        changed(changes: { [property: string]: unknown }): void;
    }

    interface DBusProxiesEvents extends EventMap {
        added(proxy: DBusProxy): void;
        changed(proxy: DBusProxy): void;
        removed(proxy: DBusProxy): void;
    }

    interface DBusProxy extends EventSource<DBusProxyEvents> {
        valid: boolean;
        [property: string]: unknown;
    }

    interface DBusOptions {
        bus?: string;
        address?: string;
        host?: string;
        superuser?: "require" | "try";
        track?: boolean;
    }

    type DBusCallOptions = {
        flags?: "" | "i",
        type?: string,
        timeout?: number,
    };

    interface DBusProxies extends EventSource<DBusProxiesEvents> {
        client: DBusClient;
        iface: string;
        path_namespace: string;
        wait(callback?: () => void): Promise<void>;
    }

    interface DBusClient {
        readonly unique_name: string;
        readonly options: DBusOptions;
        proxy(interface?: string, path?: string, options?: { watch?: boolean }): DBusProxy;
        proxies(interface?: string, path_namespace?: string, options?: { watch?: boolean }): DBusProxies;
        call(path: string, iface: string, method: string, args?: unknown[] | null, options?: DBusCallOptions): Promise<unknown[]>;
        watch(path: string): DeferredPromise<void>,
        close(): void;
    }

    type VariantType = string | Uint8Array | number | boolean | VariantType[];
    interface Variant {
        t: string;
        v: VariantType;
    }

    function dbus(name: string | null, options?: DBusOptions): DBusClient;

    function variant(type: string, value: VariantType): Variant;
    function byte_array(string: string): string;

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
        // BUG: This should be Promise<T, FileTag>, but this isn't representable (it's a cockpit.defer underneath)
        read(): Promise<T>;
        replace(new_content: T | null, expected_tag?: FileTag): Promise<FileTag>;
        watch(callback: FileWatchCallback<T>, options?: { read?: boolean }): FileWatchHandle;
        // BUG: same as read
        modify(callback: (data: T | null) => T | null, initial_content?: string, initial_tag?: FileTag): Promise<T>;
        close(): void;
        path: string;
    }

    type FileOpenOptions = {
        max_read_size?: number;
        superuser?: string;
    };

    function file(
        path: string,
        options?: FileOpenOptions & { binary?: false; syntax?: undefined; }
    ): FileHandle<string>;
    function file(
        path: string,
        options: FileOpenOptions & { binary: true; syntax?: undefined; }
    ): FileHandle<Uint8Array>;
    function file<T>(
        path: string,
        options: FileOpenOptions & { binary?: false; syntax: FileSyntaxObject<T, string>; }
    ): FileHandle<T>;
    function file<T>(
        path: string,
        options: FileOpenOptions & { binary: true; syntax: FileSyntaxObject<T, Uint8Array>; }
    ): FileHandle<T>;

    /* === cockpit.user ========================== */

    type UserInfo = {
        id: number;
        gid: number;
        name: string;
        full_name: string;
        groups: Array<string>;
        home: string;
        shell: string;
    };
    export function user(): Promise<UserInfo>;

    /* === String helpers ======================== */

    function message(problem: string | JsonObject): string;

    function format(format_string: string, ...args: unknown[]): string;

    /* === i18n ===================== */

    function gettext(message: string): string;
    function gettext(context: string, message?: string): string;
    function ngettext(message1: string, messageN: string, n: number): string;
    function ngettext(context: string, message1: string, messageN: string, n: number): string;

    function translate(): void;

    /* === Number formatting ===================== */

    type FormatOptions = {
        precision?: number;
        base2?: boolean;
    };
    type MaybeNumber = number | null | undefined;

    function format_number(n: MaybeNumber, precision?: number): string
    function format_bytes(n: MaybeNumber, options?: FormatOptions): string;
    function format_bytes_per_sec(n: MaybeNumber, options?: FormatOptions): string;
    function format_bits_per_sec(n: MaybeNumber, options?: FormatOptions & { base2?: false }): string;

    /** @deprecated */ function format_bytes(n: MaybeNumber, factor: unknown, options?: object | boolean): string | string[];
    /** @deprecated */ function format_bytes_per_sec(n: MaybeNumber, factor: unknown, options?: object | boolean): string | string[];
    /** @deprecated */ function format_bits_per_sec(n: MaybeNumber, factor: unknown, options?: object | boolean): string | string[];

    /* === Session ====================== */
    function logout(reload: boolean, reason?: string): void;

    export let localStorage: Storage;
    export let sessionStorage: Storage;

    /**
     * Options passed to the HTTP client constructor.
     */
    export interface HttpOptions {
        /**
         * The target address. If omitted, the endpoint string must include the host.
         */
        address?: string;
        /**
         * The port to connect to.
         */
        port?: number;
        /**
         * Enable TLS (HTTPS) connection.
         */
        tls?: boolean;
        /**
         * Whether to connect as superuser.
         */
        superuser?: boolean;
        /**
         * If true, responses will be delivered as binary (Uint8Array) instead of string.
         */
        binary?: boolean;
        /**
         * Default HTTP headers to send with every request.
         */
        headers?: { [key: string]: string };
        /**
         * Default query parameters to include with every request.
         */
        params?: { [key: string]: string | number };
    }

    /**
     * Allowed types for HTTP request bodies.
     * A body may be a string or a plain JavaScript object that will be encoded as JSON.
     * If the body is undefined or null, an empty HTTP body is sent.
     */
    export type HttpBody = string | { [key: string]: any } | null | undefined;

    /**
     * Options for a single HTTP request.
     */
    export interface HttpRequestOptions {
        /**
         * The path (or endpoint) of the request.
         */
        path: string;
        /**
         * The HTTP method to use, e.g. "GET", "POST", etc.
         */
        method: string;
        /**
         * Headers specific to this request.
         */
        headers?: { [key: string]: string };
        /**
         * Query parameters specific to this request.
         */
        params?: { [key: string]: string | number };
        /**
         * Request body. Can be a string or a plain object to be JSON encoded.
         */
        body?: HttpBody;
    }

    /**
     * The Cockpit HTTP client instance.
     * The generic parameter TResponse controls the type returned by the request methods.
     */
    export interface HttpInstance<TResponse = string> {
        /**
         * Performs a custom HTTP request.
         * @param options Options including path, method, headers, params, and body.
         * @returns A promise resolving to the response body.
         */
        request(options: HttpRequestOptions): Promise<TResponse>;

        /**
         * Performs an HTTP GET request.
         * @param path The endpoint path.
         * @param options Optional additional headers or query parameters.
         * @returns A promise resolving to the response body.
         */
        get(
            path: string,
            options?: Omit<HttpRequestOptions, "method" | "path" | "body">
        ): Promise<TResponse>;

        /**
         * Performs an HTTP POST request.
         * @param path The endpoint path.
         * @param body The request body (string or object). If omitted, an empty body is sent.
         * @param options Optional additional headers or query parameters.
         * @returns A promise resolving to the response body.
         */
        post(
            path: string,
            body?: HttpBody,
            options?: Omit<HttpRequestOptions, "method" | "path" | "body">
        ): Promise<TResponse>;
    }

    /**
     * Creates a new Cockpit HTTP client instance.
     * The client can be constructed with just the endpoint string or with additional options.
     * The type of the response (string vs. Uint8Array) is determined by the "binary" flag.
     *
     * @param endpoint The HTTP endpoint (address or URL).
     * @returns HTTP client instance with string response.
     */
    export function http(endpoint: string): HttpInstance<string>;

    /**
     * Creates a new Cockpit HTTP client instance with custom options.
     *
     * @param endpoint The HTTP endpoint (address or URL).
     * @param options Additional options to configure the HTTP client.
     * @returns HTTP client instance with response type based on the binary flag.
     */
    export function http(
        endpoint: string,
        options: HttpOptions & { binary?: false | undefined }
    ): HttpInstance<string>;
    export function http(
        endpoint: string,
        options: HttpOptions & { binary: true }
    ): HttpInstance<Uint8Array>;
}
