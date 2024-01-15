declare module 'cockpit';

type JsonValue = null | boolean | number | string | JsonObject | Array<JsonValue>;
type JsonObject = { [name: string]: JsonValue };

export interface EventMixin {
    addEventListener(event: string, callback: any);
    removeEventListener(event: string, callback: any);
}

function addEventListener(event: string, callback: any);
function removeEventListener(event: string, callback: any);

class BasicError {
    problem: string;
    message: string;
    toString(): string;
}

const location : {
    url_root: string;
    options: { [name: string]: string | Array<string> };
    path: Array<string>;
    href: string;
};

type UserInfo = {
    "id": number;
    "name": string;
    "full_name": string;
    "groups": Array<string>;
    "home", string;
    "shell", string;
};
function user(): Promise<UserInfo>;

type FileWatchCallback = (data: string | null, tag: string | null, error: BasicError | null) => void;
interface FileHandle {
    watch(callback: FileWatchCallback, options?: JsonObject): void;
    close(): void;
}
function file(path: string, options?: JsonObject): FileHandle;
