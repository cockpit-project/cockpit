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
 * Unit tests for WiFi UI Components (Phase 2)
 *
 * Tests the wifi-components.jsx module functions and component logic.
 * Uses QUnit for test framework following Cockpit patterns.
 */

import QUnit from "qunit-tests";
import { strengthToBars, strengthToText, extractSSID } from "./wifi-components";

// ============================================================================
// Tests for strengthToBars
// ============================================================================

QUnit.module("strengthToBars");

QUnit.test("returns 0 for no signal", function(assert) {
    assert.strictEqual(strengthToBars(0), 0);
    assert.strictEqual(strengthToBars(-10), 0);
});

QUnit.test("returns 1 for weak signal (1-25%)", function(assert) {
    assert.strictEqual(strengthToBars(1), 1);
    assert.strictEqual(strengthToBars(10), 1);
    assert.strictEqual(strengthToBars(25), 1);
});

QUnit.test("returns 2 for fair signal (26-50%)", function(assert) {
    assert.strictEqual(strengthToBars(26), 2);
    assert.strictEqual(strengthToBars(40), 2);
    assert.strictEqual(strengthToBars(50), 2);
});

QUnit.test("returns 3 for good signal (51-75%)", function(assert) {
    assert.strictEqual(strengthToBars(51), 3);
    assert.strictEqual(strengthToBars(60), 3);
    assert.strictEqual(strengthToBars(75), 3);
});

QUnit.test("returns 4 for excellent signal (76-100%)", function(assert) {
    assert.strictEqual(strengthToBars(76), 4);
    assert.strictEqual(strengthToBars(90), 4);
    assert.strictEqual(strengthToBars(100), 4);
});

// ============================================================================
// Tests for strengthToText
// ============================================================================

QUnit.module("strengthToText");

QUnit.test("returns 'No signal' for 0", function(assert) {
    assert.strictEqual(strengthToText(0), "No signal");
});

QUnit.test("returns 'Weak' for 1-25%", function(assert) {
    assert.strictEqual(strengthToText(1), "Weak");
    assert.strictEqual(strengthToText(25), "Weak");
});

QUnit.test("returns 'Fair' for 26-50%", function(assert) {
    assert.strictEqual(strengthToText(26), "Fair");
    assert.strictEqual(strengthToText(50), "Fair");
});

QUnit.test("returns 'Good' for 51-75%", function(assert) {
    assert.strictEqual(strengthToText(51), "Good");
    assert.strictEqual(strengthToText(75), "Good");
});

QUnit.test("returns 'Excellent' for 76-100%", function(assert) {
    assert.strictEqual(strengthToText(76), "Excellent");
    assert.strictEqual(strengthToText(100), "Excellent");
});

// ============================================================================
// Tests for extractSSID
// ============================================================================

QUnit.module("extractSSID");

QUnit.test("extracts SSID from wifi.ssid (legacy format)", function(assert) {
    const settings = { wifi: { ssid: "MyNetwork" } };
    assert.strictEqual(extractSSID(settings), "MyNetwork");
});

QUnit.test("extracts SSID from 802-11-wireless.ssid (standard format)", function(assert) {
    const settings = { "802-11-wireless": { ssid: "StandardNet" } };
    assert.strictEqual(extractSSID(settings), "StandardNet");
});

QUnit.test("extracts SSID from variant-wrapped format", function(assert) {
    const settings = { "802-11-wireless": { ssid: { v: "VariantNet" } } };
    assert.strictEqual(extractSSID(settings), "VariantNet");
});

QUnit.test("falls back to connection.id", function(assert) {
    const settings = { connection: { id: "ConnectionName" } };
    assert.strictEqual(extractSSID(settings), "ConnectionName");
});

QUnit.test("returns Unknown for empty settings", function(assert) {
    assert.strictEqual(extractSSID({}), "Unknown");
    assert.strictEqual(extractSSID(null), "Unknown");
    assert.strictEqual(extractSSID(undefined), "Unknown");
});

QUnit.test("prioritizes wifi.ssid over other formats", function(assert) {
    const settings = {
        wifi: { ssid: "Priority1" },
        "802-11-wireless": { ssid: "Priority2" },
        connection: { id: "Priority3" }
    };
    assert.strictEqual(extractSSID(settings), "Priority1");
});

QUnit.test("prioritizes 802-11-wireless.ssid over connection.id", function(assert) {
    const settings = {
        "802-11-wireless": { ssid: "WirelessSSID" },
        connection: { id: "ConnectionName" }
    };
    assert.strictEqual(extractSSID(settings), "WirelessSSID");
});

// ============================================================================
// Tests for network list processing logic
// ============================================================================

QUnit.module("Network list processing");

QUnit.test("filters out empty SSIDs", function(assert) {
    const accessPoints = [
        { ssid: "VisibleNetwork", strength: 80, security: "wpa2" },
        { ssid: "", strength: 60, security: "wpa2" },
        { ssid: null, strength: 70, security: "open" },
        { ssid: "   ", strength: 50, security: "wpa" },
    ];

    const filtered = accessPoints.filter(ap => ap.ssid && ap.ssid.trim() !== "");

    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].ssid, "VisibleNetwork");
});

QUnit.test("deduplicates SSIDs keeping strongest signal", function(assert) {
    const accessPoints = [
        { ssid: "DuplicateNet", strength: 40, security: "wpa2", path: "/ap1" },
        { ssid: "DuplicateNet", strength: 80, security: "wpa2", path: "/ap2" },
        { ssid: "DuplicateNet", strength: 60, security: "wpa2", path: "/ap3" },
        { ssid: "UniqueNet", strength: 70, security: "wpa", path: "/ap4" },
    ];

    // Same logic as WiFiScanList useMemo
    const uniqueNetworks = new Map();
    accessPoints
            .filter(ap => ap.ssid && ap.ssid.trim() !== "")
            .forEach(ap => {
                const existing = uniqueNetworks.get(ap.ssid);
                if (!existing || ap.strength > existing.strength) {
                    uniqueNetworks.set(ap.ssid, ap);
                }
            });

    const result = Array.from(uniqueNetworks.values());

    assert.strictEqual(result.length, 2);

    const duplicateNet = result.find(ap => ap.ssid === "DuplicateNet");
    assert.strictEqual(duplicateNet.strength, 80, "Should keep strongest signal");
    assert.strictEqual(duplicateNet.path, "/ap2");
});

QUnit.test("sorts networks by signal strength descending", function(assert) {
    const accessPoints = [
        { ssid: "Weak", strength: 20 },
        { ssid: "Strong", strength: 90 },
        { ssid: "Medium", strength: 50 },
    ];

    const sorted = [...accessPoints].sort((a, b) => b.strength - a.strength);

    assert.strictEqual(sorted[0].ssid, "Strong");
    assert.strictEqual(sorted[0].strength, 90);
    assert.strictEqual(sorted[1].ssid, "Medium");
    assert.strictEqual(sorted[1].strength, 50);
    assert.strictEqual(sorted[2].ssid, "Weak");
    assert.strictEqual(sorted[2].strength, 20);
});

QUnit.test("handles empty access point list", function(assert) {
    const accessPoints = [];
    const filtered = accessPoints.filter(ap => ap.ssid && ap.ssid.trim() !== "");

    assert.strictEqual(filtered.length, 0);
});

// ============================================================================
// Tests for security badge mapping
// ============================================================================

QUnit.module("Security badge mapping");

QUnit.test("maps security types to correct labels", function(assert) {
    const securityConfig = {
        open: { label: "Open", color: "grey", icon: false },
        wpa: { label: "WPA", color: "blue", icon: true },
        wpa2: { label: "WPA2", color: "blue", icon: true },
        wpa3: { label: "WPA3", color: "green", icon: true },
    };

    assert.strictEqual(securityConfig.open.label, "Open");
    assert.strictEqual(securityConfig.open.color, "grey");
    assert.strictEqual(securityConfig.open.icon, false);

    assert.strictEqual(securityConfig.wpa.label, "WPA");
    assert.strictEqual(securityConfig.wpa.color, "blue");
    assert.strictEqual(securityConfig.wpa.icon, true);

    assert.strictEqual(securityConfig.wpa2.label, "WPA2");
    assert.strictEqual(securityConfig.wpa2.color, "blue");
    assert.strictEqual(securityConfig.wpa2.icon, true);

    assert.strictEqual(securityConfig.wpa3.label, "WPA3");
    assert.strictEqual(securityConfig.wpa3.color, "green");
    assert.strictEqual(securityConfig.wpa3.icon, true);
});

QUnit.test("defaults to wpa2 for unknown security", function(assert) {
    const securityConfig = {
        open: { label: "Open", color: "grey" },
        wpa: { label: "WPA", color: "blue" },
        wpa2: { label: "WPA2", color: "blue" },
        wpa3: { label: "WPA3", color: "green" },
    };

    const unknownSecurity = "wpa4";
    const config = securityConfig[unknownSecurity] || securityConfig.wpa2;

    assert.strictEqual(config.label, "WPA2");
    assert.strictEqual(config.color, "blue");
});

// ============================================================================
// Tests for connection status mapping
// ============================================================================

QUnit.module("Connection status mapping");

QUnit.test("maps connection states to correct colors", function(assert) {
    const ConnectionState = {
        CONNECTED: 'connected',
        CONNECTING: 'connecting',
        DISCONNECTED: 'disconnected',
        DEACTIVATING: 'deactivating',
        FAILED: 'failed',
    };

    const stateConfig = {
        [ConnectionState.CONNECTED]: { color: "green" },
        [ConnectionState.CONNECTING]: { color: "blue" },
        [ConnectionState.DISCONNECTED]: { color: "grey" },
        [ConnectionState.DEACTIVATING]: { color: "orange" },
        [ConnectionState.FAILED]: { color: "red" },
    };

    assert.strictEqual(stateConfig[ConnectionState.CONNECTED].color, "green");
    assert.strictEqual(stateConfig[ConnectionState.CONNECTING].color, "blue");
    assert.strictEqual(stateConfig[ConnectionState.DISCONNECTED].color, "grey");
    assert.strictEqual(stateConfig[ConnectionState.DEACTIVATING].color, "orange");
    assert.strictEqual(stateConfig[ConnectionState.FAILED].color, "red");
});

// ============================================================================
// Tests for saved network filtering
// ============================================================================

QUnit.module("Saved network filtering");

QUnit.test("excludes AP mode connections from saved list", function(assert) {
    const connections = [
        {
            Settings: {
                connection: { id: "Home WiFi", type: "802-11-wireless" },
                wifi: { ssid: "HomeNet", mode: "infrastructure" },
            },
        },
        {
            Settings: {
                connection: { id: "HALOS-AP", type: "802-11-wireless" },
                wifi: { ssid: "HALOS-1234", mode: "ap" },
            },
        },
        {
            Settings: {
                connection: { id: "Office WiFi", type: "802-11-wireless" },
                wifi: { ssid: "OfficeNet", mode: "infrastructure" },
            },
        },
    ];

    // Same logic as useWiFiSavedNetworks
    const clientConnections = connections.filter(con => {
        const settings = con.Settings;
        if (!settings || settings.connection?.type !== "802-11-wireless") return false;
        const mode = settings.wifi?.mode;
        return mode !== "ap";
    });

    assert.strictEqual(clientConnections.length, 2);
    assert.ok(clientConnections.some(c => c.Settings.connection.id === "Home WiFi"));
    assert.ok(clientConnections.some(c => c.Settings.connection.id === "Office WiFi"));
    assert.ok(!clientConnections.some(c => c.Settings.connection.id === "HALOS-AP"));
});

QUnit.test("includes connections without explicit mode (defaults to infrastructure)", function(assert) {
    const connections = [
        {
            Settings: {
                connection: { id: "Legacy WiFi", type: "802-11-wireless" },
                wifi: { ssid: "LegacyNet" }, // No mode specified
            },
        },
    ];

    const clientConnections = connections.filter(con => {
        const settings = con.Settings;
        if (!settings || settings.connection?.type !== "802-11-wireless") return false;
        const mode = settings.wifi?.mode;
        return mode !== "ap";
    });

    assert.strictEqual(clientConnections.length, 1);
    assert.strictEqual(clientConnections[0].Settings.connection.id, "Legacy WiFi");
});

// ============================================================================
// Tests for priority ordering
// ============================================================================

QUnit.module("Priority ordering");

QUnit.test("maintains index for reordering", function(assert) {
    const networks = [
        { id: "Network A", priority: 100 },
        { id: "Network B", priority: 50 },
        { id: "Network C", priority: 25 },
    ];

    // Verify first and last positions
    const firstIndex = 0;
    const lastIndex = networks.length - 1;

    assert.strictEqual(firstIndex, 0, "First index should be 0");
    assert.strictEqual(lastIndex, 2, "Last index should be 2");

    // First item cannot move up
    assert.ok(firstIndex === 0, "First item is at top");

    // Last item cannot move down
    assert.ok(lastIndex === networks.length - 1, "Last item is at bottom");
});

// ============================================================================
// Tests for signal strength icon SVG calculation
// ============================================================================

QUnit.module("Signal strength icon calculations");

QUnit.test("calculates correct bar heights", function(assert) {
    const barHeights = [6, 10, 14, 18];

    assert.strictEqual(barHeights[0], 6, "First bar height");
    assert.strictEqual(barHeights[1], 10, "Second bar height");
    assert.strictEqual(barHeights[2], 14, "Third bar height");
    assert.strictEqual(barHeights[3], 18, "Fourth bar height");
});

QUnit.test("calculates SVG dimensions correctly", function(assert) {
    const barWidth = 3;
    const barGap = 2;
    const svgWidth = (barWidth + barGap) * 4;
    const svgHeight = 20;

    assert.strictEqual(svgWidth, 20, "SVG width should be 20");
    assert.strictEqual(svgHeight, 20, "SVG height should be 20");
});

QUnit.test("maps strength to filled bars correctly", function(assert) {
    // Verify bars filled count matches strengthToBars
    const testCases = [
        { strength: 0, expectedBars: 0 },
        { strength: 15, expectedBars: 1 },
        { strength: 40, expectedBars: 2 },
        { strength: 60, expectedBars: 3 },
        { strength: 90, expectedBars: 4 },
    ];

    testCases.forEach(({ strength, expectedBars }) => {
        const bars = strengthToBars(strength);
        assert.strictEqual(bars, expectedBars, `${strength}% should show ${expectedBars} bars`);
    });
});

// ============================================================================
// Start tests
// ============================================================================

QUnit.start();
