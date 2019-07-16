/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

/**
 * Validates correctness of ipv4 address
 *
 * @param {string} address
 * @returns {boolean}
 */
export function validateIpv4(address) {
    const ipv4 = address.split('.');
    if (ipv4.length !== 4)
        return false;

    for (let i = 0; i < ipv4.length; i++) {
        if (!/^[0-9]+$/.test(ipv4[i].trim()))
            return false;
        const part = parseInt(ipv4[i], 10);
        if (isNaN(part) || part < 0 || part > 255)
            return false;
    }

    return true;
}

/**
 * validates correctnes of ipv4 prefix length or mask
 *
 * @param {string} prefixOrNetmask
 * @returns {boolean}
 */
export function validateNetmask(prefixOrNetmask) {
    const netmaskParts = ["255", "254", "252", "248", "240", "224", "192", "128", "0"];
    const parts = prefixOrNetmask.split('.');

    // prefix length
    if (parts.length === 1) {
        if (!/^[0-9]+$/.test(parts[0].trim()))
            return false;
        const prefixLength = parseInt(parts[0], 10);
        if (isNaN(prefixLength) || prefixLength < 1 || prefixLength > 31)
            return false;

        return true;
    }

    // netmask
    if (!validateIpv4(prefixOrNetmask))
        return false;

    for (let i = 0; i < 4; i++) {
        if (!(netmaskParts.includes(parts[i])))
            return false;
    }

    return true;
}

/**
 * Converts ipv4 prefix length to mask if @netmask is already not mask
 *
 * @param {string} prefixOrNetmask
 * @returns {string}
 */
export function netmaskConvert(prefixOrNetmask) {
    const prefixToNetmask = {
        8: "255", 7: "254", 6: "252", 5: "248", 4: "240", 3: "224", 2: "192", 1: "128", 0: "0"
    };
    const parts = prefixOrNetmask.split('.');

    if (parts.length === 4)
        return prefixOrNetmask;

    const prefixLength = parseInt(parts[0]);

    let netmask = "";
    let i = 0;
    for (i = 0; i < Math.floor(prefixLength / 8); i++)
        netmask += "255.";

    const remainder = prefixLength % 8;
    netmask += prefixToNetmask[remainder];

    // Fill out the rest with 0s
    for (i; i < 3; i++)
        netmask += ".0";

    return netmask;
}

/**
 * Converts ipv4 address to decimal number
 *
 * @param {string} prefixOrNetmask
 * @returns {number}
 */
export function ipv4ToNum(ip) {
    const tmp = ip.split('.');
    return (tmp[0] << 24) | (tmp[1] << 16) | (tmp[2] << 8) | (tmp[3] << 0);
}

/**
 * Checks whetever address @ip is in subnet defined by @network and @netmask
 *
 * @param {string} network
 * @param {string} netmask
 * @param {string} ip
 * @returns {boolean}
 */
export function isIpv4InNetwork(network, netmask, ip) {
    network = ipv4ToNum(network);
    netmask = netmaskConvert(netmask);
    netmask = ipv4ToNum(netmask);
    ip = ipv4ToNum(ip);

    return (network & netmask) == (ip & netmask);
}

/**
 * Validates correctness of ipv6 address
 *
 * @param {string} address
 * @returns {boolean}
 */
export function validateIpv6(address) {
    const parts = address.split(':');
    if (parts.length < 1 || parts.length > 8)
        return false;

    if (parts[0] === "")
        parts[0] = "0";
    if (parts[parts.length - 1] === "")
        parts[parts.length - 1] = "0";

    let empty_seen = false;
    for (let i = 0; i < parts.length; i++) {
        if (parts[i] === "") {
            if (empty_seen)
                return false;
            empty_seen = true;
        } else {
            if (!/^[0-9a-fA-F]+$/.test(parts[i].trim()))
                return false;
            const n = parseInt(parts[i], 16);
            if (isNaN(n) || n < 0 || n > 0xFFFF)
                return false;
        }
    }

    return true;
}

/**
 * validates correctnes of ipv6 prefix length
 *
 * @param {string} prefixOrNetmask
 * @returns {boolean}
 */
export function validateIpv6Prefix(prefix) {
    if (!/^[0-9]+$/.test(prefix.trim()))
        return false;
    const prefixLength = parseInt(prefix, 10);
    if (isNaN(prefixLength) || prefixLength < 0 || prefixLength > 128)
        return false;

    return true;
}

/**
 * Converts ipv6 address to string containing it's binary representation
 *
 * @param {string} ip
 * @returns {string}
 */
export function ipv6ToBinStr(ip) {
    let parts = [];
    ip.split(":").forEach(part => {
        let bin = parseInt(part, 16).toString(2);
        while (bin.length < 16)
            bin = "0" + bin;
        parts.push(bin);
    });
    return parts.join("");
}

/**
 * Checks whetever IPv6 address @ip is in subnet defined by @network and @prefix
 *
 * @param {string} network
 * @param {string} prefix
 * @param {string} ip
 * @returns {boolean}
 */
export function isIpv6InNetwork(network, prefix, ip) {
    network = ipv6ToBinStr(network);
    network = network.substring(0, prefix);
    ip = ipv6ToBinStr(ip);
    ip = ip.substring(0, prefix);

    return network == ip;
}
