#!/usr/bin/env node
/*
 * WiFi Data Access Validation Script
 *
 * This script validates the WiFi data transformation functions work correctly
 * Tests encode/decode of SSIDs and security flag parsing
 */

// Simulate cockpit.base64_encode/decode
const cockpit = {
    base64_encode: (bytes) => Buffer.from(bytes).toString('base64'),
    base64_decode: (str) => {
        if (!str) return new Uint8Array();
        return new Uint8Array(Buffer.from(str, 'base64'));
    }
};

// Import the utility functions we're testing
function decode_nm_property(bytes) {
    if (!bytes || bytes.length === 0) return "";

    // Check if bytes is a base64 string (Cockpit's D-Bus returns byte arrays as base64)
    if (typeof bytes === 'string') {
        // Decode base64 to byte array using Cockpit's built-in function
        bytes = cockpit.base64_decode(bytes);
    }

    // Ensure we have a Uint8Array for proper UTF-8 decoding
    if (!(bytes instanceof Uint8Array)) {
        bytes = new Uint8Array(bytes);
    }

    // Decode as UTF-8 (supports all Unicode characters including emoji)
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(bytes);
}

function encode_nm_property(str) {
    if (!str) return [];

    // Use TextEncoder for proper UTF-8 encoding (supports all Unicode characters)
    const encoder = new TextEncoder();
    return Array.from(encoder.encode(str));
}

// Parse security flags from AccessPoint properties
function parseSecurityFlags(flags, wpaFlags, rsnFlags) {
    // No security
    if (flags === 0 && wpaFlags === 0 && rsnFlags === 0) {
        return "open";
    }

    // WPA3 (SAE)
    if (rsnFlags & 0x100) {
        return "wpa3";
    }

    // WPA2 (RSN)
    if (rsnFlags !== 0) {
        return "wpa2";
    }

    // WPA
    if (wpaFlags !== 0) {
        return "wpa";
    }

    return "wpa2"; // default assumption
}

// Test runner
function runTests() {
    let passed = 0;
    let failed = 0;

    function assert(condition, message) {
        if (condition) {
            console.log(`✅ PASS: ${message}`);
            passed++;
        } else {
            console.log(`❌ FAIL: ${message}`);
            failed++;
        }
    }

    function assertEqual(actual, expected, message) {
        const equal = JSON.stringify(actual) === JSON.stringify(expected);
        assert(equal, `${message} (expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)})`);
    }

    console.log("\n=== WiFi Data Access Validation ===\n");

    // Test 1: ASCII SSID encode/decode
    console.log("Test 1: ASCII SSID encode/decode");
    const ssid1 = "Stairway to Heaven";
    const encoded1 = encode_nm_property(ssid1);
    const base64_1 = cockpit.base64_encode(encoded1);
    const decoded1 = decode_nm_property(base64_1);
    assertEqual(decoded1, ssid1, "ASCII SSID roundtrip");

    // Test 2: UTF-8 SSID with special characters
    console.log("\nTest 2: UTF-8 SSID with special characters");
    const ssid2 = "Café WiFi";
    const encoded2 = encode_nm_property(ssid2);
    const base64_2 = cockpit.base64_encode(encoded2);
    const decoded2 = decode_nm_property(base64_2);
    assertEqual(decoded2, ssid2, "UTF-8 SSID roundtrip");

    // Test 3: Emoji in SSID
    console.log("\nTest 3: Emoji in SSID");
    const ssid3 = "🏠 Home Network";
    const encoded3 = encode_nm_property(ssid3);
    const base64_3 = cockpit.base64_encode(encoded3);
    const decoded3 = decode_nm_property(base64_3);
    assertEqual(decoded3, ssid3, "Emoji SSID roundtrip");

    // Test 4: Empty SSID
    console.log("\nTest 4: Empty SSID");
    assertEqual(encode_nm_property(""), [], "Empty string encodes to empty array");
    assertEqual(decode_nm_property(""), "", "Empty string decodes to empty string");
    assertEqual(decode_nm_property(null), "", "null decodes to empty string");

    // Test 5: Security flag parsing - Open network
    console.log("\nTest 5: Security flag parsing - Open");
    assertEqual(parseSecurityFlags(0, 0, 0), "open", "No flags = open network");

    // Test 6: Security flag parsing - WPA2
    console.log("\nTest 6: Security flag parsing - WPA2");
    assertEqual(parseSecurityFlags(1, 0, 0x10), "wpa2", "RSN flags = WPA2");

    // Test 7: Security flag parsing - WPA3
    console.log("\nTest 7: Security flag parsing - WPA3");
    assertEqual(parseSecurityFlags(1, 0, 0x100), "wpa3", "SAE flag = WPA3");

    // Test 8: Security flag parsing - WPA
    console.log("\nTest 8: Security flag parsing - WPA");
    assertEqual(parseSecurityFlags(1, 0x10, 0), "wpa", "WPA flags only = WPA");

    // Test 9: Real-world SSID test
    console.log("\nTest 9: Real-world SSIDs");
    const realSSIDs = [
        "NETGEAR24",
        "TP-Link_5G",
        "My Home WiFi",
        "Guest Network 2.4GHz",
        "Network-🔒-Secure"
    ];
    realSSIDs.forEach(ssid => {
        const enc = encode_nm_property(ssid);
        const b64 = cockpit.base64_encode(enc);
        const dec = decode_nm_property(b64);
        assertEqual(dec, ssid, `Real SSID: "${ssid}"`);
    });

    // Summary
    console.log("\n" + "=".repeat(40));
    console.log(`Total: ${passed + failed} tests`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log("=".repeat(40) + "\n");

    return failed === 0;
}

// Run the tests
const success = runTests();
process.exit(success ? 0 : 1);
