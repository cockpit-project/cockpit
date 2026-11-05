/*
 * Copyright (C) 2016 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import * as ipaddr from "ipaddr.js";

const _ = cockpit.gettext;

type IPAddress = ipaddr.IPv4 | ipaddr.IPv6;

// Partial NetworkManager objects types

type NMIPMethod = "auto" | "manual" | "dhcp" | "link-local" | "ignore" | "shared" | "disabled";

type NMIPSettings = {
    method: NMIPMethod;
    address_data: {
        address: string;
        prefix: string;
    }[];
    dns_data: string[];
    dns_search: string[];
    route_data: unknown[];
    gateway: string;
}

export type NMConnectionSettings = {
    connection: {
        interface_name: string | undefined;
        autoconnect: boolean;
        autoconnect_priority: number;
        // Optional because createGhostConnectionSettings() doesn't set default values
        id?: string;
        uuid?: string;
        multi_connect?: number;
        type?: string;
    };
    ipv4?: NMIPSettings;
    ipv6?: NMIPSettings;
    "802-11-wireless"?: {
        ssid: string;
        mode: string;
        hidden: boolean;
    };
    "802-11-wireless-security"?: {
        "key-mgmt": string;
        psk: string;
    };
}

export type NMConnection = {
    Settings?: NMConnectionSettings;
    Unsaved: boolean;
    activate(dev: NMDevice, specific_object: NMAccessPoint | null): Promise<unknown>;
    delete_(): Promise<void>;
}

export type NMAccessPoint = {
    Ssid: string;
    Flags: number;
    WpaFlags: number;
    RsnFlags: number;
    Connection?: NMConnection | null;
}

export type NMDevice = {
    StateText: string;
    // this is type_ActiveConnection
    ActiveConnection: unknown;
    ActiveAccessPoint: NMAccessPoint | null | undefined;
    AccessPoints: NMAccessPoint[];
    activate_with_settings(settings: NMConnectionSettings, specific_object: NMAccessPoint | null): Promise<{ connection: NMConnection; active_connection: unknown }>;
    wait_connection(expected_ssid: string): Promise<void>;
    cancel_pending_connection(): void;
}

export type NMInterface = {
    Name: string;
    Device: NMDevice;
    MainConnection: NMConnection | null;
}

/* NetworkManager specific data conversions and utility functions.
 */

type ByteOrder = "be" | "le" | undefined;
let byteorder: ByteOrder;

export function set_byteorder(bo: ByteOrder) {
    byteorder = bo;
}

export function ip_prefix_to_text(num: number): string {
    return num.toString();
}

export function ip_prefix_from_text(text: string): number {
    if (/^[0-9]+$/.test(text.trim()))
        return parseInt(text, 10);

    throw cockpit.format(_("Invalid prefix $0"), text);
}

export function ip_metric_to_text(num: number): string {
    return num.toString();
}

export function ip_metric_from_text(text: string): number {
    if (text === "")
        return 0;

    if (/^[0-9]+$/.test(text.trim()))
        return parseInt(text, 10);

    throw cockpit.format(_("Invalid metric $0"), text);
}

export function ip_network_address(address: IPAddress, prefix_len: number): string | null {
    const addrCIDR = address.toString() + "/" + prefix_len;
    const ip_obj = address.kind() === "ipv4" ? ipaddr.IPv4 : ipaddr.IPv6;

    try {
        return ip_obj.networkAddressFromCIDR(addrCIDR).toString();
    } catch (_e) {
        return null;
    }
}

export function ip_first_usable_address(address: IPAddress, prefix: number): string | null {
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

function toDec(n: number): string {
    return n.toString(10);
}

function bytes_from_nm32(num: number): number[] {
    const bytes = [];
    if (byteorder === "be") {
        for (let i = 3; i >= 0; i--) {
            bytes[i] = num & 0xFF;
            num = num >>> 8;
        }
    } else if (byteorder === "le") {
        for (let i = 0; i < 4; i++) {
            bytes[i] = num & 0xFF;
            num = num >>> 8;
        }
    } else {
        throw new Error("byteorder is unset or has invalid value " + JSON.stringify(byteorder));
    }
    return bytes;
}

export function validate_ipv4(address: string): boolean {
    // explicitly require all 4 octets
    // NM does not support any IPv4 short format
    return ipaddr.IPv4.isValidFourPartDecimal(address);
}

export function validate_ipv6(address: string): boolean {
    return ipaddr.IPv6.isValid(address);
}

export function validate_ip(address: string): boolean {
    return validate_ipv4(address) || validate_ipv6(address);
}

export function ip4_to_text(num: number, zero_is_empty?: boolean): string {
    if (num === 0 && zero_is_empty)
        return "";
    return bytes_from_nm32(num).map(toDec)
            .join('.');
}

export function ip4_from_text(text: string, empty_is_zero?: boolean): number {
    function invalid(): never {
        throw cockpit.format(_("Invalid address $0"), text);
    }

    if (text === "" && empty_is_zero)
        return 0;

    const parts = text.split('.');
    if (parts.length !== 4)
        invalid();

    const bytes = parts.map(function(s) {
        if (/^[0-9]+$/.test(s.trim()))
            return parseInt(s, 10);
        else
            return invalid();
    });

    let num = 0;
    function shift(b: number) {
        if (isNaN(b) || b < 0 || b > 0xFF)
            invalid();
        num = 0x100 * num + b;
    }

    if (byteorder === "be") {
        for (let i = 0; i < 4; i++) {
            shift(bytes[i]);
        }
    } else if (byteorder === "le") {
        for (let i = 3; i >= 0; i--) {
            shift(bytes[i]);
        }
    } else {
        throw new Error("byteorder is unset or has invalid value " + JSON.stringify(byteorder));
    }

    return num;
}

export function ip4_prefix_from_text(prefix_mask: string): number {
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
// NetworkManager already handles dropping of leading zeros within a single 16 bit field
// but does not replace the longest consecutive zeros fields with "::".
function ip6_shorten(ip6_addr: string): string {
    function find_longest_zero(match: RegExpMatchArray[]): number {
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
    const short_addr = ip6_addr.replace(match[longest_idx][0], "::");

    return short_addr;
}

export function ip6_to_text(data: string, zero_is_empty?: boolean): string {
    const parts = [];
    const bytes = cockpit.base64_decode(data);
    for (let i = 0; i < 8; i++)
        parts[i] = ((bytes[2 * i] << 8) + bytes[2 * i + 1]).toString(16);
    const result = parts.join(':');
    if (result === "0:0:0:0:0:0:0:0" && zero_is_empty)
        return "";
    return ip6_shorten(result);
}

export function ip6_from_text(text: string, empty_is_zero?: boolean): string {
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
    if (j !== 8)
        invalid();

    return cockpit.base64_encode(bytes);
}

// SSID comes as a base64-encoded string from D-Bus (signature 'ay')
export const ssid_from_nm = (bytes: string | null | undefined): string => new TextDecoder().decode(
    new Uint8Array(cockpit.base64_decode(bytes ?? ""))
);

export const ssid_to_nm = (ssid: string): string => cockpit.base64_encode(new TextEncoder().encode(ssid));

export function list_interfaces() {
    return new Promise((resolve, _reject) => {
        const client = cockpit.dbus("org.freedesktop.NetworkManager");
        client.call('/org/freedesktop/NetworkManager',
                    'org.freedesktop.NetworkManager',
                    'GetAllDevices', [])
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .then((reply: any[]) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    Promise.all(reply[0].map((device: any) => {
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
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            .then((interfaces: any[]) => {
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

// Check if we are working with non-persistent multi-connection,
// namely the `id=Wired Connection` generated by networkmanager.
//
// When editing this connection, we need to create a new connection
// on top of this, remove the multiconnection settings and assign it directly
// to interface. This is done for Anaconda in order to avoid creating unexpected
// multiconnections when user modifies the connection during installation.
export function isNonPersistentMultiCon(connection: NMConnection): boolean {
    const settings = connection?.Settings;
    if (settings &&
        settings.connection.interface_name === undefined &&
        settings.connection.id === "Wired Connection" &&
        connection.Unsaved === true && settings.connection.type &&
        settings.connection.multi_connect === 3 &&
        settings.connection.type === "802-3-ethernet") {
        return true;
    }

    return false;
}

export function createNewConnSettings(settings: NMConnectionSettings, iface_name: string) {
    const newSettings = {
        ...settings,
        connection: {
            ...settings.connection,
            id: iface_name,
            interface_name: iface_name,
            // increase the current priority by 1, maximum priority is 999
            autoconnect_priority: Math.min(settings.connection.autoconnect_priority + 1, 999),
        }
    };
    delete newSettings.connection.uuid;
    delete newSettings.connection.multi_connect;

    return newSettings;
}

const NM80211ApFlags = {
    // access point has no special capabilities
    NONE: 0x00000000,
    // access point requires authentication and encryption (usually means WEP)
    PRIVACY: 0x00000001,
} as const;

const NM80211ApSecurityFlags = {
    // the access point has no special security requirements
    NONE: 0x00000000,
    // 40/64-bit WEP is supported for pairwise/unicast encryption
    PAIR_WEP40: 0x00000001,
    // 104/128-bit WEP is supported for pairwise/unicast encryption
    PAIR_WEP104: 0x00000002,
    // TKIP is supported for pairwise/unicast encryption
    PAIR_TKIP: 0x00000004,
    // AES/CCMP is supported for pairwise/unicast encryption
    PAIR_CCMP: 0x00000008,
    // 40/64-bit WEP is supported for group/broadcast encryption
    GROUP_WEP40: 0x00000010,
    // 104/128-bit WEP is supported for group/broadcast encryption
    GROUP_WEP104: 0x00000020,
    // TKIP is supported for group/broadcast encryption
    GROUP_TKIP: 0x00000040,
    // AES/CCMP is supported for group/broadcast encryption
    GROUP_CCMP: 0x00000080,
    // WPA/RSN Pre-Shared Key encryption is supported
    KEY_MGMT_PSK: 0x00000100,
    // 802.1x authentication and key management is supported
    KEY_MGMT_802_1X: 0x00000200,
} as const;

// See NetworkManager examples for access point flags conversion:
// https://github.com/NetworkManager/NetworkManager/blob/1c71c568e7736ce2075fd0d53c387f2221bab832/examples/python/gi/show-wifi-networks.py#L64-L76
export function apSecurityFlagsToString(flags: number, wpaFlags: number, rsnFlags: number): string {
    let str = "";
    if ((flags & NM80211ApFlags.PRIVACY) && wpaFlags === 0 && rsnFlags === 0) {
        str += " WEP";
    }
    if (wpaFlags !== 0) {
        str += " WPA1";
    }
    if (rsnFlags !== 0) {
        str += " WPA2";
    }
    if ((wpaFlags & NM80211ApSecurityFlags.KEY_MGMT_802_1X) || (rsnFlags & NM80211ApSecurityFlags.KEY_MGMT_802_1X)) {
        str += " 802.1X";
    }
    if (str === "") {
        str = _("Unsecured");
    }

    return str.trimStart();
}

export async function existingConnectionConnectToAP(ap: NMAccessPoint, dev: NMDevice) {
    // Activate existing connection (which already has password if needed)
    cockpit.assert(ap.Connection, "existingConnectionConnectToAP requires an existing connection");
    debug("Activating existing connection for", ap.Ssid);
    await ap.Connection.activate(dev, ap);
    debug("Connection activation started for", ap.Ssid);
    await dev.wait_connection(ap.Ssid);
    debug("Connected successfully to", ap.Ssid);
}

export function prepareWirelessConSettings(ssid: string, security: string, password: string) {
    // Create new connection for open networks
    debug("Creating new connection for", ssid);
    const isHidden = !ssid;
    const settings: NMConnectionSettings = {
        connection: {
            id: ssid,
            type: "802-11-wireless",
            interface_name: undefined,
            autoconnect: true,
            autoconnect_priority: 0,
        },
        "802-11-wireless": {
            ssid: ssid_to_nm(ssid),
            mode: "infrastructure",
            hidden: isHidden,
        }
    };

    if (security === "none") {
        return settings;
    }

    if (!isHidden || security !== "none") {
        settings["802-11-wireless-security"] = {
            "key-mgmt": isHidden ? security : "wpa-psk",
            psk: password,
        };
    }

    return settings;
}

// Connect to a wireless access point
//
// Optionally this function takes a `registerCancel` callback, which is meant
// to be used with the dialog.set_cancel method to register a cancel function
// in a dialog.
export async function connectToAccessPoint(dev: NMDevice, ssid: string, security: string, password: string, registerCancel?: (cancel: () => void) => void) {
    const settings = prepareWirelessConSettings(ssid, security, password);

    let connection: NMConnection | null = null;
    try {
        // ap might be stale if there was a scan since opening the dialog, so pass NULL
        // NM will find the right AP by SSID
        const result = await dev.activate_with_settings(settings, null);
        connection = result.connection;

        if (registerCancel) {
            registerCancel(() => {
                debug("Cancelling connection to", ssid);
                dev.cancel_pending_connection();
                connection?.delete_()
                        .catch((err: unknown) => console.warn("Failed to delete connection:", err));
            });
        }

        debug("Connection activation started");
        await dev.wait_connection(ssid);
        debug("Connected successfully to", ssid);
    } catch (err) {
        // just in case something survived, clean up
        connection?.delete_()
                .catch(err => debug("Failed to delete failed connection:", err));

        throw err;
    }
}

export function debug(...args: Parameters<typeof console.debug>): void {
    if (window.debugging === "all" || window.debugging?.includes("networkmanager")) // not-covered: debugging
        console.debug("networkmanager:", ...args); // not-covered: debugging
}
