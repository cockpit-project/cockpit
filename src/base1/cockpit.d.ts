interface Func1<T, R = void> {
    (arg: T): R;
}

interface Func2<T, K, R = void> {
    (arg1: T, arg2: K): R;
}

interface Func3<T, K, V, R = void> {
    (arg1: T, arg2: K, arg3: V): R;
}

type GUID = string;

type Fail = {
    message: string;
    problem?: string;
};

type SpawnFail = Fail & {
    exit_status?: number;
    exit_signal?: number;
};

type ErrorConfig = 'message' | 'out' | 'ignore' | 'pty';
type Superuser = 'require' | 'try';
type ProblemCodes = 'access-denied' | 'authentication-failed' | 'internal-error' | 'no-cockpit' | 'no-session' | 'not-found' | 'terminated' | 'timeout' | 'unknown-hostkey' | 'no-forwarding';

type SpawnConfig = {
    err?: ErrorConfig;
    binary?: boolean;
    directory?: string;
    host?: string;
    environ?: string[];
    pty?: boolean;
    batch?: boolean;
    latency?: number;
    superuser?: Superuser;
};

interface SyntaxParser<K> {
    parse: Func1<string, K>;
    stringify: Func1<K, string>;
}

type FileConfig<K extends object = {}> = {
    syntax?: SyntaxParser<K>;
    binary?: boolean;
    max_read_size?: number;
    superuser?: Superuser;
    host?: string;
};

interface FileOperationsPromise extends JQuery.Promise<string> {}

interface ClosableWithProblem { close(problem?: ProblemCodes): void; } 

interface FileOperations extends Closable {
    read(): FileOperationsPromise;
    replace(content: string | null, tag?: string): FileOperationsPromise;
    modify(): FileOperationsPromise;
    watch(callback: Func3<string, string, string> | Func2<string, string>): void;
    /**
     * A string containing the path that was passed to the `cockpit.file()` method.
     */
    path: string;
}

interface SpawnPromise extends JQuery.Promise<string>, ClosableWithProblem {
    stream(callback: Func1<string>): SpawnPromise;
    input(data?: string | Uint8Array, stream?: boolean): SpawnPromise;
}

interface Closable { close(): void; }

function CacheProvider(provide: Func1<any>, key: any): Closable | null;

interface UserInfo {
    id: number;
    name: string;
    full_name: string;
    groups: string[];
    home: string;
    shell: string;
}

interface EventHandler<V, T = string> {
    addEventListener(type: T, handler: Func1<CustomEvent<V>>);
    removeEventListener(type: T, handler: Func1<CustomEvent<V>>);
    dispatchEvent(event: Event);
}

interface UserInfoPromise extends JQuery.Promise<UserInfo> {}

type PermissionOptions = { group: string };

type PermissionEvents = 'changed';

interface PermissionInfo extends EventHandler<PermissionInfoPromise, PermissionEvents>, Closable {
    allowed: boolean;
    user: UserInfo;
};

interface PermissionInfoPromise extends JQuery.Promise<PermissionInfo> {};

type HttpHeaders = any;

interface HttpOptions {
    address: string;
    connection: string;
    superuser: Superuser;
}

type HttpData = string | Uint8Array;

declare const enum HttpMethod {
    Get = 'GET',
    Post = 'POST',
    Head = 'HEAD'
}

interface HttpRequestOptions {
    body?: HttpData;
    headers?: HttpHeaders;
    method?: HttpMethod;
    params?: any;
    path?: string;
}

interface HttpOperations extends ClosableWithProblem {
    get(path: string, params: any, headers: HttpHeaders): HttpOperationsPromise;
    post(path: string, body: string | any, headers: HttpHeaders): HttpOperationsPromise;
    request(options: HttpRequestOptions): HttpOperationsPromise;
}

interface HttpOperationsPromise extends JQuery.Promise<HttpData>, ClosableWithProblem {
    response(handler: Func2<number, HttpHeaders>): HttpOperationsPromise;
    stream(handler: Func1<HttpData>): HttpOperationsPromise;
    input(handler: HttpData, stream?: boolean): HttpOperationsPromise;
}

interface CockpitAPI {
    spawn(path: string[], config?: SpawnConfig): SpawnPromise;
    script(path: string, args?: string[], config?: SpawnConfig): SpawnPromise;
    file(path: string): FileOperations;
    cache(key: GUID, provider: CacheProvider, consumer: Func2<any, any>): Closable;
    logout(reload: boolean): void;
    user(): UserInfoPromise;
    permission(options?: PermissionOptions): PermissionInfoPromise;
    http(endpoint: string | number, options: HttpOptions): HttpOperations;
}

declare var cockpit : CockpitAPI;
declare module 'cockpit' {
    export default cockpit;
    export { Superuser, ErrorConfig, ProblemCodes };
}
