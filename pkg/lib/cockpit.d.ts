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

declare module 'cockpit' {
    type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
    type JsonObject = Record<string, JsonValue>;

    class BasicError {
        problem: string;
        message: string;
        toString(): string;
    }

    function assert(predicate: unknown, message?: string): asserts predicate;

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

    function channel(options: ChannelOptions & { binary?: false; }): Channel<string>;
    function channel(options: ChannelOptions & { binary: true; }): Channel<Uint8Array>;

    /* === cockpit.location ========================== */

    interface Location {
        url_root: string;
        options: { [name: string]: string | Array<string> };
        path: Array<string>;
        href: string;
        go(path: Location | string, options?: { [key: string]: string }): void;
        replace(path: Location | string, options?: { [key: string]: string }): void;
    }

    export const location: Location;

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
        proxy(interface: string, path: string, options?: { watch?: boolean }): DBusProxy;
        close(): void;
    }

    function dbus(name: string | null, options?: DBusOptions): DBusClient;

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
        name: string;
        full_name: string;
        groups: Array<string>;
        home: string;
        shell: string;
    };
    export function user(): Promise<UserInfo>;

    /* === String helpers ======================== */

    type FormatOptions = {
        precision?: number;
        separate?: boolean;
    };

    type ByteUnit = {
        name: string | null;
        factor: number;
        selected?: boolean;
    };

    function message(problem: string | JsonObject): string;

    function gettext(message: string): string;
    function gettext(context: string, message?: string): string;
    function ngettext(message1: string, messageN: string, n: number): string;
    function ngettext(context: string, message1: string, messageN: string, n: number): string;

    function format(format_string: string, ...args: unknown[]): string;
    function format_number(n: number, precision?: number): string
    function format_bytes(n: number, factor?: 1000 | 1024, options?: FormatOptions & { separate?: false }): string;
    function format_bytes(n: number, factor: 1000 | 1024, options: FormatOptions & { separate: true }): string[];
    function format_bytes_per_sec(n: number, factor?: 1000 | 1024, options?: FormatOptions & { separate?: false }): string;
    function format_bytes_per_sec(n: number, factor: 1000 | 1024, options: FormatOptions & { separate: true }): string[];
    function format_bits_per_sec(n: number, factor?: 1000 | 1024, options?: FormatOptions & { separate?: false }): string;
    function format_bits_per_sec(n: number, factor: 1000 | 1024, options: FormatOptions & { separate: true }): string[];
    function get_byte_units(guide_value: number, factor?: 1000 | 1024): ByteUnit[];
}
