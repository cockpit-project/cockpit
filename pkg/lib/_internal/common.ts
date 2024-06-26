export type StrOrBytes = string | Uint8Array;

/*
 * The debugging property is a global that is used
 * by various parts of the code to show/hide debug
 * messages in the javascript console.
 *
 * We support using storage to get/set that property
 * so that it carries across the various frames or
 * alternatively persists across refreshes.
 */
if (typeof window.debugging === "undefined") {
    try {
        // Sometimes this throws a SecurityError such as during testing
        Object.defineProperty(window, "debugging", {
            get: function() { return window.sessionStorage.debugging || window.localStorage.debugging },
            set: function(x) { window.sessionStorage.debugging = x }
        });
    } catch (e) { }
}

export function in_array(array: unknown[], val: unknown): boolean {
    const length = array.length;
    for (let i = 0; i < length; i++) {
        if (val === array[i])
            return true;
    }
    return false;
}

export function is_function(x: unknown): x is (...args: unknown[]) => unknown {
    return typeof x === 'function';
}

export function is_object(x: unknown): x is object {
    return x !== null && typeof x === 'object';
}

export function is_plain_object(x: unknown): boolean {
    return is_object(x) && Object.prototype.toString.call(x) === '[object Object]';
}

export function invoke_functions<F extends (...args: never[]) => void>(functions: F[], self: ThisType<F>, args: Parameters<F>): void {
    const length = functions?.length ?? 0;
    for (let i = 0; i < length; i++) {
        if (functions[i])
            functions[i].apply(self, args);
    }
}

export function iterate_data(data: StrOrBytes, callback: (chunk: StrOrBytes) => void, batch: number = 64 * 1024): void {
    if (typeof data === 'string') {
        for (let i = 0; i < data.length; i += batch) {
            callback(data.substring(i, i + batch));
        }
    } else if (data) {
        for (let i = 0; i < data.byteLength; i += batch) {
            const n = Math.min(data.byteLength - i, batch);
            callback(new Uint8Array(data.buffer, i, n));
        }
    }
}

export function join_data(buffers: StrOrBytes[], binary: boolean): StrOrBytes {
    if (!binary)
        return buffers.join("");

    let total = 0;
    const length = buffers.length;
    for (let i = 0; i < length; i++)
        total += buffers[i].length;

    const data = new Uint8Array(total);
    for (let j = 0, i = 0; i < length; i++) {
        data.set(buffers[i] as Uint8Array, j);
        j += buffers[i].length;
    }

    return data;
}
