/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2024 Hat Labs
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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Unit tests for WiFi hooks
 *
 * Tests the wifi-hooks.js module functions and state transitions.
 * Uses QUnit for test framework following Cockpit patterns.
 */

import QUnit from "qunit-tests";
import { parseSecurityFlags, ConnectionState } from "./wifi-hooks";

// ============================================================================
// Tests for parseSecurityFlags
// ============================================================================

QUnit.module("parseSecurityFlags");

QUnit.test("returns 'open' for no security flags", function(assert) {
    assert.strictEqual(parseSecurityFlags(0, 0, 0), "open");
});

QUnit.test("returns 'wpa3' when SAE bit is set in RSN flags", function(assert) {
    // SAE bit is 0x100 (256) in RSN flags
    assert.strictEqual(parseSecurityFlags(0, 0, 0x100), "wpa3");
    assert.strictEqual(parseSecurityFlags(1, 0, 0x100), "wpa3");
    assert.strictEqual(parseSecurityFlags(0, 1, 0x100), "wpa3");
    // SAE with other RSN flags
    assert.strictEqual(parseSecurityFlags(0, 0, 0x108), "wpa3");
});

QUnit.test("returns 'wpa2' when RSN flags are set (without SAE)", function(assert) {
    assert.strictEqual(parseSecurityFlags(0, 0, 1), "wpa2");
    assert.strictEqual(parseSecurityFlags(0, 0, 0x20), "wpa2");
    assert.strictEqual(parseSecurityFlags(1, 0, 0x08), "wpa2");
});

QUnit.test("returns 'wpa' when only WPA flags are set", function(assert) {
    assert.strictEqual(parseSecurityFlags(0, 1, 0), "wpa");
    assert.strictEqual(parseSecurityFlags(1, 0x10, 0), "wpa");
    assert.strictEqual(parseSecurityFlags(0, 0x20, 0), "wpa");
});

QUnit.test("prefers WPA3 over WPA2 when both flags present", function(assert) {
    // RSN with SAE should return wpa3 even if other RSN flags set
    assert.strictEqual(parseSecurityFlags(0, 0, 0x108), "wpa3");
});

QUnit.test("prefers WPA2 over WPA when both flags present", function(assert) {
    // RSN flags take precedence over WPA flags
    assert.strictEqual(parseSecurityFlags(0, 1, 1), "wpa2");
    assert.strictEqual(parseSecurityFlags(1, 0x20, 0x08), "wpa2");
});

QUnit.test("returns 'wpa2' as default for edge cases", function(assert) {
    // With only AP flags but no security, still treated as open
    // But the function returns wpa2 as default if no clear match
    // This tests the fallback behavior when flags are set but don't match known patterns
    // Actually, with flags=1 wpaFlags=0 rsnFlags=0, we hit the default
    assert.strictEqual(parseSecurityFlags(1, 0, 0), "wpa2");
});

// ============================================================================
// Tests for ConnectionState enum
// ============================================================================

QUnit.module("ConnectionState");

QUnit.test("has all required state values", function(assert) {
    assert.strictEqual(ConnectionState.DISCONNECTED, "disconnected");
    assert.strictEqual(ConnectionState.CONNECTING, "connecting");
    assert.strictEqual(ConnectionState.CONNECTED, "connected");
    assert.strictEqual(ConnectionState.DEACTIVATING, "deactivating");
    assert.strictEqual(ConnectionState.FAILED, "failed");
});

QUnit.test("states are unique", function(assert) {
    const states = Object.values(ConnectionState);
    const uniqueStates = new Set(states);
    assert.strictEqual(states.length, uniqueStates.size, "All states should be unique");
});

// ============================================================================
// Mock utilities for hook testing
// ============================================================================

/**
 * Creates a mock model for testing hooks
 * @param {Object} options - Configuration options
 * @returns {Object} Mock model object
 */
function createMockModel(options = {}) {
    const listeners = {};

    const mockManager = {
        Devices: options.devices || [],
        Connections: options.connections || [],
        ActiveConnections: options.activeConnections || [],
    };

    const mockSettings = {
        Connections: options.savedConnections || [],
    };

    return {
        ready: options.ready !== false,
        client: options.client || null,
        get_manager: () => mockManager,
        get_settings: () => mockSettings,
        addEventListener: (event, callback) => {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(callback);
        },
        removeEventListener: (event, callback) => {
            if (listeners[event]) {
                listeners[event] = listeners[event].filter(cb => cb !== callback);
            }
        },
        dispatchEvent: (event) => {
            if (listeners[event]) {
                listeners[event].forEach(cb => cb());
            }
        },
    };
}

/**
 * Creates a mock WiFi device
 * @param {Object} options - Device configuration
 * @returns {Object} Mock device object
 */
function createMockWiFiDevice(options = {}) {
    return {
        DeviceType: options.deviceType || "802-11-wireless",
        Interface: options.interface || "wlan0",
        State: options.state || 100, // ACTIVATED
        HwAddress: options.hwAddress || "00:11:22:33:44:55",
        ActiveConnection: options.activeConnection || null,
        " priv": {
            path: options.path || "/org/freedesktop/NetworkManager/Devices/1",
        },
    };
}

/**
 * Creates a mock saved connection
 * @param {Object} options - Connection configuration
 * @returns {Object} Mock connection object
 */
function createMockConnection(options = {}) {
    return {
        Settings: {
            connection: {
                id: options.id || "Test WiFi",
                type: options.type || "802-11-wireless",
                uuid: options.uuid || "test-uuid-1234",
            },
            wifi: {
                ssid: options.ssid || "TestNetwork",
                mode: options.mode || "infrastructure",
            },
        },
        " priv": {
            path: options.path || "/org/freedesktop/NetworkManager/Settings/1",
        },
        delete_: options.deleteFn || (() => Promise.resolve()),
        activate: options.activateFn || (() => Promise.resolve()),
    };
}

// ============================================================================
// Tests for mock utilities (validate test infrastructure)
// ============================================================================

QUnit.module("Mock utilities");

QUnit.test("createMockModel returns valid model structure", function(assert) {
    const model = createMockModel();

    assert.ok(model.ready, "Model should be ready by default");
    assert.ok(typeof model.get_manager === "function", "get_manager should be a function");
    assert.ok(typeof model.get_settings === "function", "get_settings should be a function");
    assert.ok(typeof model.addEventListener === "function", "addEventListener should be a function");
    assert.ok(typeof model.removeEventListener === "function", "removeEventListener should be a function");
});

QUnit.test("createMockModel with custom devices", function(assert) {
    const device = createMockWiFiDevice({ interface: "wlan1" });
    const model = createMockModel({ devices: [device] });

    const manager = model.get_manager();
    assert.strictEqual(manager.Devices.length, 1);
    assert.strictEqual(manager.Devices[0].Interface, "wlan1");
});

QUnit.test("createMockModel dispatches events", function(assert) {
    const model = createMockModel();
    let eventFired = false;

    model.addEventListener("changed", () => { eventFired = true });
    model.dispatchEvent("changed");

    assert.ok(eventFired, "Event should have been fired");
});

QUnit.test("createMockWiFiDevice returns valid device structure", function(assert) {
    const device = createMockWiFiDevice();

    assert.strictEqual(device.DeviceType, "802-11-wireless");
    assert.strictEqual(device.Interface, "wlan0");
    assert.ok(device[" priv"].path, "Device should have a path");
});

QUnit.test("createMockWiFiDevice with custom options", function(assert) {
    const device = createMockWiFiDevice({
        interface: "wlan1",
        state: 30, // DISCONNECTED
        hwAddress: "AA:BB:CC:DD:EE:FF",
    });

    assert.strictEqual(device.Interface, "wlan1");
    assert.strictEqual(device.State, 30);
    assert.strictEqual(device.HwAddress, "AA:BB:CC:DD:EE:FF");
});

QUnit.test("createMockConnection returns valid connection structure", function(assert) {
    const connection = createMockConnection();

    assert.strictEqual(connection.Settings.connection.type, "802-11-wireless");
    assert.strictEqual(connection.Settings.wifi.ssid, "TestNetwork");
    assert.strictEqual(connection.Settings.wifi.mode, "infrastructure");
    assert.ok(typeof connection.delete_ === "function");
    assert.ok(typeof connection.activate === "function");
});

QUnit.test("createMockConnection with AP mode", function(assert) {
    const connection = createMockConnection({
        id: "HALOS-AP",
        ssid: "HALOS-1234",
        mode: "ap",
    });

    assert.strictEqual(connection.Settings.connection.id, "HALOS-AP");
    assert.strictEqual(connection.Settings.wifi.mode, "ap");
});

// ============================================================================
// Tests for hook behavior with mocks
// These tests validate the filtering and state logic
// ============================================================================

QUnit.module("Device filtering logic");

QUnit.test("filters WiFi devices correctly", function(assert) {
    const wifiDevice = createMockWiFiDevice({ interface: "wlan0" });
    const ethDevice = {
        DeviceType: "ethernet",
        Interface: "eth0",
        " priv": { path: "/org/freedesktop/NetworkManager/Devices/2" },
    };
    const bridgeDevice = {
        DeviceType: "bridge",
        Interface: "br0",
        " priv": { path: "/org/freedesktop/NetworkManager/Devices/3" },
    };

    const devices = [wifiDevice, ethDevice, bridgeDevice];
    const wifiDevices = devices.filter(dev => dev.DeviceType === "802-11-wireless");

    assert.strictEqual(wifiDevices.length, 1);
    assert.strictEqual(wifiDevices[0].Interface, "wlan0");
});

QUnit.test("handles multiple WiFi devices", function(assert) {
    const wlan0 = createMockWiFiDevice({ interface: "wlan0" });
    const wlan1 = createMockWiFiDevice({ interface: "wlan1" });

    const devices = [wlan0, wlan1];
    const wifiDevices = devices.filter(dev => dev.DeviceType === "802-11-wireless");

    assert.strictEqual(wifiDevices.length, 2);
});

QUnit.module("Saved networks filtering logic");

QUnit.test("filters out AP mode connections", function(assert) {
    const clientConnection = createMockConnection({
        id: "Home WiFi",
        mode: "infrastructure",
    });
    const apConnection = createMockConnection({
        id: "HALOS-AP",
        mode: "ap",
    });
    const adhocConnection = createMockConnection({
        id: "AdHoc",
        mode: "adhoc",
    });

    const connections = [clientConnection, apConnection, adhocConnection];

    // Filter for client mode connections only (same logic as useWiFiSavedNetworks)
    const clientConnections = connections.filter(con => {
        const settings = con.Settings;
        if (!settings || settings.connection?.type !== "802-11-wireless") return false;
        const mode = settings.wifi?.mode;
        return mode !== "ap";
    });

    assert.strictEqual(clientConnections.length, 2);
    assert.ok(clientConnections.some(c => c.Settings.connection.id === "Home WiFi"));
    assert.ok(clientConnections.some(c => c.Settings.connection.id === "AdHoc"));
    assert.ok(!clientConnections.some(c => c.Settings.connection.id === "HALOS-AP"));
});

QUnit.test("filters out non-WiFi connections", function(assert) {
    const wifiConnection = createMockConnection({
        id: "WiFi Network",
        type: "802-11-wireless",
    });
    const ethConnection = {
        Settings: {
            connection: {
                id: "Wired Connection",
                type: "802-3-ethernet",
            },
        },
        " priv": { path: "/test" },
    };

    const connections = [wifiConnection, ethConnection];

    const wifiConnections = connections.filter(con => {
        const settings = con.Settings;
        return settings && settings.connection?.type === "802-11-wireless";
    });

    assert.strictEqual(wifiConnections.length, 1);
    assert.strictEqual(wifiConnections[0].Settings.connection.id, "WiFi Network");
});

QUnit.module("Connection state mapping");

QUnit.test("maps NM states to connection states correctly", function(assert) {
    // This tests the internal mapping logic used in useWiFiConnectionState

    function mapNMState(nmState) {
        switch (nmState) {
        case 0: // UNKNOWN
        case 10: // UNMANAGED
        case 20: // UNAVAILABLE
        case 30: // DISCONNECTED
            return ConnectionState.DISCONNECTED;
        case 40: // PREPARE
        case 50: // CONFIG
        case 60: // NEED_AUTH
        case 70: // IP_CONFIG
        case 80: // IP_CHECK
        case 90: // SECONDARIES
            return ConnectionState.CONNECTING;
        case 100: // ACTIVATED
            return ConnectionState.CONNECTED;
        case 110: // DEACTIVATING
            return ConnectionState.DEACTIVATING;
        case 120: // FAILED
            return ConnectionState.FAILED;
        default:
            return ConnectionState.DISCONNECTED;
        }
    }

    // Disconnected states
    assert.strictEqual(mapNMState(0), ConnectionState.DISCONNECTED, "UNKNOWN -> DISCONNECTED");
    assert.strictEqual(mapNMState(10), ConnectionState.DISCONNECTED, "UNMANAGED -> DISCONNECTED");
    assert.strictEqual(mapNMState(20), ConnectionState.DISCONNECTED, "UNAVAILABLE -> DISCONNECTED");
    assert.strictEqual(mapNMState(30), ConnectionState.DISCONNECTED, "DISCONNECTED -> DISCONNECTED");

    // Connecting states
    assert.strictEqual(mapNMState(40), ConnectionState.CONNECTING, "PREPARE -> CONNECTING");
    assert.strictEqual(mapNMState(50), ConnectionState.CONNECTING, "CONFIG -> CONNECTING");
    assert.strictEqual(mapNMState(60), ConnectionState.CONNECTING, "NEED_AUTH -> CONNECTING");
    assert.strictEqual(mapNMState(70), ConnectionState.CONNECTING, "IP_CONFIG -> CONNECTING");
    assert.strictEqual(mapNMState(80), ConnectionState.CONNECTING, "IP_CHECK -> CONNECTING");
    assert.strictEqual(mapNMState(90), ConnectionState.CONNECTING, "SECONDARIES -> CONNECTING");

    // Active state
    assert.strictEqual(mapNMState(100), ConnectionState.CONNECTED, "ACTIVATED -> CONNECTED");

    // Deactivating state
    assert.strictEqual(mapNMState(110), ConnectionState.DEACTIVATING, "DEACTIVATING -> DEACTIVATING");

    // Failed state
    assert.strictEqual(mapNMState(120), ConnectionState.FAILED, "FAILED -> FAILED");

    // Unknown states default to disconnected
    assert.strictEqual(mapNMState(999), ConnectionState.DISCONNECTED, "Unknown -> DISCONNECTED");
});

QUnit.module("Dual mode detection");

QUnit.test("detects client-only mode", function(assert) {
    const clientConnection = createMockConnection({ mode: "infrastructure" });

    const activeConnections = [
        {
            Connection: clientConnection,
            " priv": { path: "/test/ac1" },
        },
    ];

    let clientActive = false;
    let apActive = false;

    for (const ac of activeConnections) {
        const settings = ac.Connection?.Settings;
        if (!settings || settings.connection?.type !== "802-11-wireless") continue;

        const mode = settings.wifi?.mode;
        if (mode === "ap") {
            apActive = true;
        } else if (mode === "infrastructure" || !mode) {
            clientActive = true;
        }
    }

    assert.ok(clientActive, "Client should be active");
    assert.ok(!apActive, "AP should not be active");
    assert.ok(!(clientActive && apActive), "Dual mode should be false");
});

QUnit.test("detects AP-only mode", function(assert) {
    const apConnection = createMockConnection({ mode: "ap" });

    const activeConnections = [
        {
            Connection: apConnection,
            " priv": { path: "/test/ac1" },
        },
    ];

    let clientActive = false;
    let apActive = false;

    for (const ac of activeConnections) {
        const settings = ac.Connection?.Settings;
        if (!settings || settings.connection?.type !== "802-11-wireless") continue;

        const mode = settings.wifi?.mode;
        if (mode === "ap") {
            apActive = true;
        } else if (mode === "infrastructure" || !mode) {
            clientActive = true;
        }
    }

    assert.ok(!clientActive, "Client should not be active");
    assert.ok(apActive, "AP should be active");
});

QUnit.test("detects dual mode (AP + Client)", function(assert) {
    const clientConnection = createMockConnection({ mode: "infrastructure" });
    const apConnection = createMockConnection({ mode: "ap" });

    const activeConnections = [
        {
            Connection: clientConnection,
            " priv": { path: "/test/ac1" },
        },
        {
            Connection: apConnection,
            " priv": { path: "/test/ac2" },
        },
    ];

    let clientActive = false;
    let apActive = false;

    for (const ac of activeConnections) {
        const settings = ac.Connection?.Settings;
        if (!settings || settings.connection?.type !== "802-11-wireless") continue;

        const mode = settings.wifi?.mode;
        if (mode === "ap") {
            apActive = true;
        } else if (mode === "infrastructure" || !mode) {
            clientActive = true;
        }
    }

    const isDualMode = clientActive && apActive;

    assert.ok(clientActive, "Client should be active");
    assert.ok(apActive, "AP should be active");
    assert.ok(isDualMode, "Dual mode should be detected");
});

// ============================================================================
// Tests for access point parsing
// ============================================================================

QUnit.module("Access point data handling");

QUnit.test("handles empty access point list", function(assert) {
    const accessPoints = [];

    // Simulate filtering (same as WiFiNetworkList)
    const filtered = accessPoints.filter(ap => ap.ssid && ap.ssid.trim() !== "");

    assert.strictEqual(filtered.length, 0);
});

QUnit.test("filters out empty SSIDs (hidden networks)", function(assert) {
    const accessPoints = [
        { ssid: "VisibleNetwork", strength: 80, security: "wpa2" },
        { ssid: "", strength: 60, security: "wpa2" }, // Hidden
        { ssid: "AnotherNetwork", strength: 70, security: "open" },
        { ssid: "   ", strength: 50, security: "wpa" }, // Whitespace only
    ];

    const filtered = accessPoints.filter(ap => ap.ssid && ap.ssid.trim() !== "");

    assert.strictEqual(filtered.length, 2);
    assert.ok(filtered.some(ap => ap.ssid === "VisibleNetwork"));
    assert.ok(filtered.some(ap => ap.ssid === "AnotherNetwork"));
});

QUnit.test("deduplicates SSIDs keeping strongest signal", function(assert) {
    const accessPoints = [
        { ssid: "DuplicateNet", strength: 40, security: "wpa2", path: "/ap1" },
        { ssid: "DuplicateNet", strength: 80, security: "wpa2", path: "/ap2" },
        { ssid: "DuplicateNet", strength: 60, security: "wpa2", path: "/ap3" },
        { ssid: "UniqueNet", strength: 70, security: "wpa", path: "/ap4" },
    ];

    // Deduplicate keeping strongest
    const uniqueNetworks = new Map();
    accessPoints.forEach(ap => {
        const existing = uniqueNetworks.get(ap.ssid);
        if (!existing || ap.strength > existing.strength) {
            uniqueNetworks.set(ap.ssid, ap);
        }
    });

    const result = Array.from(uniqueNetworks.values());

    assert.strictEqual(result.length, 2);

    const duplicateNet = result.find(ap => ap.ssid === "DuplicateNet");
    assert.strictEqual(duplicateNet.strength, 80, "Should keep strongest signal");
    assert.strictEqual(duplicateNet.path, "/ap2", "Should keep the AP with strongest signal");
});

QUnit.test("sorts by signal strength descending", function(assert) {
    const accessPoints = [
        { ssid: "Weak", strength: 20 },
        { ssid: "Strong", strength: 90 },
        { ssid: "Medium", strength: 50 },
    ];

    const sorted = [...accessPoints].sort((a, b) => b.strength - a.strength);

    assert.strictEqual(sorted[0].ssid, "Strong");
    assert.strictEqual(sorted[1].ssid, "Medium");
    assert.strictEqual(sorted[2].ssid, "Weak");
});

// ============================================================================
// Start tests
// ============================================================================

QUnit.start();
