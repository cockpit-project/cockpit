/*
 * Copyright (C) 2016 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import * as ipaddr from "ipaddr.js";

const _ = cockpit.gettext;

/* NetworkManager specific data conversions and utility functions.
 */

let byteorder;

export function set_byteorder(bo) {
    byteorder = bo;
}

export function ip_prefix_to_text(num) {
    return num.toString();
}

export function ip_prefix_from_text(text) {
    if (/^[0-9]+$/.test(text.trim()))
        return parseInt(text, 10);

    throw cockpit.format(_("Invalid prefix $0"), text);
}

export function ip_metric_to_text(num) {
    return num.toString();
}

export function ip_metric_from_text(text) {
    if (text === "")
        return 0;

    if (/^[0-9]+$/.test(text.trim()))
        return parseInt(text, 10);

    throw cockpit.format(_("Invalid metric $0"), text);
}

export function ip_network_address(address, prefix_len) {
    const addrCIDR = address.toString() + "/" + prefix_len;
    const ip_obj = address.kind() === "ipv4" ? ipaddr.IPv4 : ipaddr.IPv6;

    try {
        return ip_obj.networkAddressFromCIDR(addrCIDR).toString();
    } catch (_e) {
        return null;
    }
}

export function ip_first_usable_address(address, prefix) {
    try {
        const addr_cidr = address.toString() + "/" + prefix;

        if (address.kind() === "ipv4") {
            const netAddr = ipaddr.IPv4.networkAddressFromCIDR(addr_cidr);
            netAddr.octets[3] += (prefix < 31) ? 1 : 0;
            return netAddr.toString();
        } else {
            const netAddr = ipaddr.IPv6.networkAddressFromCIDR(addr_cidr);
            netAddr.parts[7] += (prefix < 127) ? 1 : 0;
            return netAddr.toString();
        }
    } catch (_e) {
        return null;
    }
}

function toDec(n) {
    return n.toString(10);
}

function bytes_from_nm32(num) {
    const bytes = [];
    if (byteorder == "be") {
        for (let i = 3; i >= 0; i--) {
            bytes[i] = num & 0xFF;
            num = num >>> 8;
        }
    } else if (byteorder == "le") {
        for (let i = 0; i < 4; i++) {
            bytes[i] = num & 0xFF;
            num = num >>> 8;
        }
    } else {
        throw new Error("byteorder is unset or has invalid value " + JSON.stringify(byteorder));
    }
    return bytes;
}

export function validate_ipv4(address) {
    // explicitly require all 4 octets
    // NM does not support any IPv4 short format
    return ipaddr.IPv4.isValidFourPartDecimal(address);
}

export function validate_ipv6(address) {
    return ipaddr.IPv6.isValid(address);
}

export function validate_ip(address) {
    return validate_ipv4(address) || validate_ipv6(address);
}

export function ip4_to_text(num, zero_is_empty) {
    if (num === 0 && zero_is_empty)
        return "";
    return bytes_from_nm32(num).map(toDec)
            .join('.');
}

export function ip4_from_text(text, empty_is_zero) {
    function invalid() {
        throw cockpit.format(_("Invalid address $0"), text);
    }

    if (text === "" && empty_is_zero)
        return 0;

    const parts = text.split('.');
    if (parts.length != 4)
        invalid();

    const bytes = parts.map(function(s) {
        if (/^[0-9]+$/.test(s.trim()))
            return parseInt(s, 10);
        else
            return invalid();
    });

    let num = 0;
    function shift(b) {
        if (isNaN(b) || b < 0 || b > 0xFF)
            invalid();
        num = 0x100 * num + b;
    }

    if (byteorder == "be") {
        for (let i = 0; i < 4; i++) {
            shift(bytes[i]);
        }
    } else if (byteorder == "le") {
        for (let i = 3; i >= 0; i--) {
            shift(bytes[i]);
        }
    } else {
        throw new Error("byteorder is unset or has invalid value " + JSON.stringify(byteorder));
    }

    return num;
}

export function ip4_prefix_from_text(prefix_mask) {
    const trimmed_mask = prefix_mask.trim();
    if (/^[0-9]+$/.test(trimmed_mask)) {
        return parseInt(prefix_mask, 10);
    }

    // make sure that mask has 4 octets format
    if (validate_ipv4(trimmed_mask)) {
        const prefix = ipaddr.IPv4.parse(trimmed_mask).prefixLengthFromSubnetMask();
        if (prefix !== null) {
            return prefix;
        }
    }

    throw cockpit.format(_("Invalid prefix or netmask $0"), prefix_mask);
}

// Shorten IPv6 address according to RFC 5952
// https://datatracker.ietf.org/doc/html/rfc5952#section-4
//
// NetworkManager already handles dropping of leadin zeros within a single 16 bit field
// but does not replace the longest consecutive zeros fields with "::".
function ip6_shorten(ip6_addr) {
    function find_longest_zero(match) {
        let idx = -1;
        let length = 0;

        match.forEach((item, i) => {
            const count_zero = item[0].replaceAll(':', '').length;
            if (count_zero > length) {
                idx = i;
                length = count_zero;
            }
        });

        return idx;
    }

    const REGEX_MATCH_CONSECUTIVE_ZEROS = /\b:?(?:0:?){2,}/g;
    const match = [...ip6_addr.matchAll(REGEX_MATCH_CONSECUTIVE_ZEROS)];

    // nothing to shorten
    if (match.length === 0) {
        return ip6_addr;
    }

    const longest_idx = find_longest_zero(match);
    // replace first (leftmost) match
    const short_addr = ip6_addr.replace(match[longest_idx], "::");

    return short_addr;
}

export function ip6_to_text(data, zero_is_empty) {
    const parts = [];
    const bytes = cockpit.base64_decode(data);
    for (let i = 0; i < 8; i++)
        parts[i] = ((bytes[2 * i] << 8) + bytes[2 * i + 1]).toString(16);
    const result = parts.join(':');
    if (result == "0:0:0:0:0:0:0:0" && zero_is_empty)
        return "";
    return ip6_shorten(result);
}

export function ip6_from_text(text, empty_is_zero) {
    function invalid() {
        throw cockpit.format(_("Invalid address $0"), text);
    }

    if (text === "" && empty_is_zero)
        return cockpit.base64_encode([0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0,
        ]);

    const parts = text.split(':');
    if (parts.length < 1 || parts.length > 8)
        invalid();

    if (parts[0] === "")
        parts[0] = "0";
    if (parts[parts.length - 1] === "")
        parts[parts.length - 1] = "0";

    const bytes = [];
    let empty_seen = false;
    let j = 0;
    for (let i = 0; i < parts.length; i++, j++) {
        if (parts[i] === "") {
            if (empty_seen)
                invalid();
            empty_seen = true;
            while (j < i + (8 - parts.length)) {
                bytes[2 * j] = bytes[2 * j + 1] = 0;
                j++;
            }
        } else {
            if (!/^[0-9a-fA-F]+$/.test(parts[i].trim()))
                invalid();
            const n = parseInt(parts[i], 16);
            if (isNaN(n) || n < 0 || n > 0xFFFF)
                invalid();
            bytes[2 * j] = n >> 8;
            bytes[2 * j + 1] = n & 0xFF;
        }
    }
    if (j != 8)
        invalid();

    return cockpit.base64_encode(bytes);
}

// SSID comes as a base64-encoded string from D-Bus (signature 'ay')
export const ssid_from_nm = bytes => new TextDecoder().decode(
    new Uint8Array(cockpit.base64_decode(bytes ?? []))
);

export const ssid_to_nm = ssid => cockpit.base64_encode(new TextEncoder().encode(ssid));

export function list_interfaces() {
    return new Promise((resolve, reject) => {
        const client = cockpit.dbus("org.freedesktop.NetworkManager");
        client.call('/org/freedesktop/NetworkManager',
                    'org.freedesktop.NetworkManager',
                    'GetAllDevices', [])
                .then(reply => {
                    Promise.all(reply[0].map(device => {
                        return Promise.all([
                            client.call(device,
                                        'org.freedesktop.DBus.Properties',
                                        'Get', ['org.freedesktop.NetworkManager.Device', 'Interface'])
                                    .then(reply => reply[0]),
                            client.call(device,
                                        'org.freedesktop.DBus.Properties',
                                        'Get', ['org.freedesktop.NetworkManager.Device', 'Capabilities'])
                                    .then(reply => reply[0])
                        ]);
                    }))
                            .then(interfaces => {
                                client.close();
                                resolve(interfaces.map(i => {
                                    return { device: i[0].v, capabilities: i[1].v };
                                }));
                            })
                            .catch(e => console.warn(JSON.stringify(e)));
                })
                .catch(e => console.warn(JSON.stringify(e)));
    });
}

export function debug() {
    if (window.debugging == "all" || window.debugging?.includes("networkmanager")) // not-covered: debugging
        console.debug("networkmanager:", ...arguments); // not-covered: debugging
}
