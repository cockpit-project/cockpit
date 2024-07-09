/*
 * These are the polyfills from Mozilla. It's pretty nasty that
 * these weren't in the typed array standardization.
 *
 * https://developer.mozilla.org/en-US/docs/Glossary/Base64
 */

function uint6_to_b64 (x) {
    return x < 26 ? x + 65 : x < 52 ? x + 71 : x < 62 ? x - 4 : x === 62 ? 43 : x === 63 ? 47 : 65;
}

export function base64_encode(data) {
    if (typeof data === "string")
        return window.btoa(data);
    /* For when the caller has chosen to use ArrayBuffer */
    if (data instanceof window.ArrayBuffer)
        data = new window.Uint8Array(data);
    const length = data.length;
    let mod3 = 2;
    let str = "";
    for (let uint24 = 0, i = 0; i < length; i++) {
        mod3 = i % 3;
        uint24 |= data[i] << (16 >>> mod3 & 24);
        if (mod3 === 2 || length - i === 1) {
            str += String.fromCharCode(uint6_to_b64(uint24 >>> 18 & 63),
                                       uint6_to_b64(uint24 >>> 12 & 63),
                                       uint6_to_b64(uint24 >>> 6 & 63),
                                       uint6_to_b64(uint24 & 63));
            uint24 = 0;
        }
    }

    return str.substr(0, str.length - 2 + mod3) + (mod3 === 2 ? '' : mod3 === 1 ? '=' : '==');
}

function b64_to_uint6 (x) {
    return x > 64 && x < 91
        ? x - 65
        : x > 96 && x < 123
            ? x - 71
            : x > 47 && x < 58 ? x + 4 : x === 43 ? 62 : x === 47 ? 63 : 0;
}

export function base64_decode(str, constructor) {
    if (constructor === String)
        return window.atob(str);
    const ilen = str.length;
    let eq;
    for (eq = 0; eq < 3; eq++) {
        if (str[ilen - (eq + 1)] != '=')
            break;
    }
    const olen = (ilen * 3 + 1 >> 2) - eq;
    const data = new (constructor || Array)(olen);
    for (let mod3, mod4, uint24 = 0, oi = 0, ii = 0; ii < ilen; ii++) {
        mod4 = ii & 3;
        uint24 |= b64_to_uint6(str.charCodeAt(ii)) << 18 - 6 * mod4;
        if (mod4 === 3 || ilen - ii === 1) {
            for (mod3 = 0; mod3 < 3 && oi < olen; mod3++, oi++)
                data[oi] = uint24 >>> (16 >>> mod3 & 24) & 255;
            uint24 = 0;
        }
    }
    return data;
}
