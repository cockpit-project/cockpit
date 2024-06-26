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

export function in_array(array, val) {
    const length = array.length;
    for (let i = 0; i < length; i++) {
        if (val === array[i])
            return true;
    }
    return false;
}

export function is_function(x) {
    return typeof x === 'function';
}

export function is_object(x) {
    return x !== null && typeof x === 'object';
}

export function is_plain_object(x) {
    return is_object(x) && Object.prototype.toString.call(x) === '[object Object]';
}

export function invoke_functions(functions, self, args) {
    const length = functions?.length ?? 0;
    for (let i = 0; i < length; i++) {
        if (functions[i])
            functions[i].apply(self, args);
    }
}

export function iterate_data(data, callback, batch) {
    let binary = false;
    let len = 0;

    if (!batch)
        batch = 64 * 1024;

    if (data) {
        if (data.byteLength) {
            len = data.byteLength;
            binary = true;
        } else if (data.length) {
            len = data.length;
        }
    }

    for (let i = 0; i < len; i += batch) {
        const n = Math.min(len - i, batch);
        if (binary)
            callback(new window.Uint8Array(data.buffer, i, n));
        else
            callback(data.substr(i, n));
    }
}

export function join_data(buffers, binary) {
    if (!binary)
        return buffers.join("");

    let total = 0;
    const length = buffers.length;
    for (let i = 0; i < length; i++)
        total += buffers[i].length;

    const data = window.Uint8Array ? new window.Uint8Array(total) : new Array(total);

    if (data.set) {
        for (let j = 0, i = 0; i < length; i++) {
            data.set(buffers[i], j);
            j += buffers[i].length;
        }
    } else {
        for (let j = 0, i = 0; i < length; i++) {
            for (let k = 0; k < buffers[i].length; k++)
                data[i + j] = buffers[i][k];
            j += buffers[i].length;
        }
    }

    return data;
}
