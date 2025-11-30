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

import React, { useContext, useState, useEffect, useCallback, useRef } from 'react';
import cockpit from 'cockpit';

import { Alert } from '@patternfly/react-core/dist/esm/components/Alert/index.js';
import { Badge } from '@patternfly/react-core/dist/esm/components/Badge/index.js';
import { Button } from '@patternfly/react-core/dist/esm/components/Button/index.js';
import { Card, CardBody, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Checkbox } from '@patternfly/react-core/dist/esm/components/Checkbox/index.js';
import { DescriptionList, DescriptionListGroup, DescriptionListTerm, DescriptionListDescription } from '@patternfly/react-core/dist/esm/components/DescriptionList/index.js';
import { EmptyState, EmptyStateBody } from '@patternfly/react-core/dist/esm/components/EmptyState/index.js';
import { Form, FormGroup, FormHelperText } from '@patternfly/react-core/dist/esm/components/Form/index.js';
import { HelperText, HelperTextItem } from '@patternfly/react-core/dist/esm/components/HelperText/index.js';
import { Label } from '@patternfly/react-core/dist/esm/components/Label/index.js';
import { List, ListItem } from '@patternfly/react-core/dist/esm/components/List/index.js';
import { Spinner } from '@patternfly/react-core/dist/esm/components/Spinner/index.js';
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';
import { TextInput } from '@patternfly/react-core/dist/esm/components/TextInput/index.js';
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Name, NetworkModal, dialogSave } from "./dialogs-common";
import { ModelContext } from './model-context';
import { useDialogs } from 'dialogs.jsx';
import { v4 as uuidv4 } from 'uuid';
import { decode_nm_property } from './utils';

const _ = cockpit.gettext;

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

// Signal Strength Component
const SignalStrength = ({ strength }) => {
    // Convert 0-100 strength to 0-5 bars
    const bars = Math.ceil(strength / 20);
    const barChars = ['▁', '▂', '▃', '▅', '▇'];

    return (
        <span className="signal-strength">
            {barChars.slice(0, Math.max(1, bars)).join('')}
        </span>
    );
};

// Security Badge Component
const SecurityBadge = ({ security }) => {
    const variants = {
        open: { text: _("Open"), color: "grey" },
        wpa: { text: _("WPA"), color: "blue" },
        wpa2: { text: _("WPA2"), color: "blue" },
        wpa3: { text: _("WPA3"), color: "green" },
    };

    const { text, color } = variants[security] || variants.wpa2;

    return (
        <Badge className="security-badge" style={{ backgroundColor: color }}>
            {text}
        </Badge>
    );
};

// WiFi Network List Item
const WiFiNetworkItem = ({ ap, onClick }) => {
    return (
        <ListItem onClick={onClick} style={{ cursor: 'pointer' }}>
            <Flex>
                <FlexItem flex={{ default: 'flex_2' }}>{ap.ssid}</FlexItem>
                <FlexItem><SignalStrength strength={ap.strength} /></FlexItem>
                <FlexItem><SecurityBadge security={ap.security} /></FlexItem>
            </Flex>
        </ListItem>
    );
};

// WiFi Network List Component
const WiFiNetworkList = ({ accessPoints, onConnect, scanning }) => {
    if (scanning) {
        return <Spinner />;
    }

    if (accessPoints.length === 0) {
        return (
            <EmptyState>

                <EmptyStateBody>{_("No networks found")}</EmptyStateBody>
            </EmptyState>
        );
    }

    // Filter out empty SSIDs (hidden networks) and deduplicate by SSID
    // Keep only the strongest signal for each unique SSID
    const uniqueNetworks = new Map();
    accessPoints
            .filter(ap => ap.ssid && ap.ssid.trim() !== "") // Filter out empty/hidden SSIDs
            .forEach(ap => {
                const existing = uniqueNetworks.get(ap.ssid);
                if (!existing || ap.strength > existing.strength) {
                    uniqueNetworks.set(ap.ssid, ap);
                }
            });

    // Convert back to array and sort by signal strength
    const sorted = Array.from(uniqueNetworks.values())
            .sort((a, b) => b.strength - a.strength);

    if (sorted.length === 0) {
        return (
            <EmptyState>
                <EmptyStateBody>{_("No networks found")}</EmptyStateBody>
            </EmptyState>
        );
    }

    return (
        <List isPlain>
            {sorted.map((ap, idx) => (
                <WiFiNetworkItem
                    key={ap.path || idx}
                    ap={ap}
                    onClick={() => onConnect(ap)}
                />
            ))}
        </List>
    );
};

// WiFi Connect Dialog
export const WiFiConnectDialog = ({ settings, connection, dev, ap }) => {
    const Dialogs = useDialogs();
    const model = useContext(ModelContext);
    const idPrefix = "network-wifi-connect";

    const [iface, setIface] = useState(settings.connection.interface_name || (dev && dev.Interface) || "");
    const [ssid, setSSID] = useState(ap ? ap.ssid : (settings.wifi?.ssid || ""));
    const [password, setPassword] = useState("");
    const [dialogError, setDialogError] = useState("");

    const isCreateDialog = !connection;

    // Validate password for WPA/WPA2/WPA3 networks
    const validatePassword = (pwd, security) => {
        if (!security || security === "open") return { valid: true, message: "" };
        if (!pwd && connection) return { valid: true, message: "" }; // Empty password OK for editing (keeps existing)
        if (pwd.length === 0) return { valid: false, message: _("Password is required for secure networks") };
        if (pwd.length < 8) return { valid: false, message: _("Password must be at least 8 characters") };
        if (pwd.length > 63) return { valid: false, message: _("Password must not exceed 63 characters") };
        return { valid: true, message: "" };
    };

    const passwordValidation = validatePassword(password, ap?.security);
    const isPasswordValid = passwordValidation.valid;

    const onSubmit = (ev) => {
        if (ev) {
            ev.preventDefault();
        }

        // Validate password before submitting
        if (!isPasswordValid) {
            setDialogError(passwordValidation.message);
            return;
        }

        // Build WiFi connection settings
        const wifiSettings = {
            ...settings,
            connection: {
                ...settings.connection,
                id: ssid,
                type: "802-11-wireless",
                uuid: settings.connection.uuid || uuidv4(),
                interface_name: iface,
                autoconnect: true,
            },
            wifi: {
                ssid,
                mode: "infrastructure",
            },
            ipv4: settings.ipv4 || { method: "auto" },
            ipv6: settings.ipv6 || { method: "auto" },
        };

        // Add security if password provided
        if (password) {
            wifiSettings.wifi_security = {
                key_mgmt: "wpa-psk",
                psk: password,
            };
        } else if (ap && ap.security !== "open") {
            setDialogError(_("Password required for secure network"));
            return;
        }

        dialogSave({
            model,
            dev,
            connection,
            settings: wifiSettings,
            setDialogError,
            onClose: () => {
                // Clear password from memory
                setPassword("");
                Dialogs.close();
            },
        });
    };

    return (
        <NetworkModal
            id={idPrefix + "-dialog"}
            title={isCreateDialog ? _("Connect to WiFi") : _("Edit WiFi Connection")}
            dialogError={dialogError}
            onSubmit={onSubmit}
            isCreateDialog={isCreateDialog}
        >
            <Form isHorizontal onSubmit={onSubmit}>
                <Name
                    idPrefix={idPrefix}
                    iface={iface}
                    setIface={setIface}
                />

                <FormGroup label={_("Network name (SSID)")} fieldId={idPrefix + "-ssid-input"}>
                    <TextInput
                        id={idPrefix + "-ssid-input"}
                        value={ssid}
                        onChange={(_, val) => setSSID(val)}
                        isRequired
                    />
                </FormGroup>

                {(!ap || ap.security !== "open") && (
                    <FormGroup label={_("Password")} fieldId={idPrefix + "-password-input"}>
                        <TextInput
                            id={idPrefix + "-password-input"}
                            type="password"
                            value={password}
                            onChange={(_, val) => setPassword(val)}
                            placeholder={connection ? _("Leave empty to keep existing password") : _("Enter password")}
                            validated={password && !isPasswordValid ? "error" : "default"}
                        />
                        {password && !isPasswordValid && (
                            <FormHelperText>
                                <HelperText>
                                    <HelperTextItem variant="error">
                                        {passwordValidation.message}
                                    </HelperTextItem>
                                </HelperText>
                            </FormHelperText>
                        )}
                        {(!password && !connection) && (
                            <FormHelperText>
                                <HelperText>
                                    <HelperTextItem>
                                        {_("Password must be 8-63 characters")}
                                    </HelperTextItem>
                                </HelperText>
                            </FormHelperText>
                        )}
                    </FormGroup>
                )}
            </Form>
        </NetworkModal>
    );
};

// WiFi Access Point Dialog
export const WiFiAPDialog = ({ settings, connection, dev }) => {
    const Dialogs = useDialogs();
    const model = useContext(ModelContext);
    const idPrefix = "network-wifi-ap";

    const [iface, setIface] = useState(settings.connection.interface_name || (dev && dev.Interface) || "");
    const [ssid, setSSID] = useState(settings.wifi?.ssid || generateDefaultSSID(dev));
    const [password, setPassword] = useState("");
    const [securityType, setSecurityType] = useState(settings.wifi_security?.key_mgmt || "wpa-psk");
    const [band, setBand] = useState(settings.wifi?.band || "bg");
    const [channel, setChannel] = useState(settings.wifi?.channel || 0);
    const [hidden, setHidden] = useState(settings.wifi?.hidden || false);
    const [ipAddress, setIPAddress] = useState(settings.ipv4?.address_data?.[0]?.address || "10.42.0.1");
    const [prefix, setPrefix] = useState(settings.ipv4?.address_data?.[0]?.prefix || 24);
    const [dialogError, setDialogError] = useState("");

    const isCreateDialog = !connection;

    // Validate SSID
    const validateSSID = (value) => {
        const str = typeof value === 'string' ? value : String(value || '');
        if (!str || str.trim() === "") {
            return { valid: false, message: _("SSID cannot be empty") };
        }
        // SSID maximum is 32 bytes (UTF-8 encoding may be fewer characters)
        const bytes = new TextEncoder().encode(str);
        if (bytes.length > 32) {
            return { valid: false, message: _("SSID too long (maximum 32 bytes)") };
        }
        return { valid: true, message: "" };
    };

    // Validate password
    const validatePassword = (value, secType) => {
        // Open network - no password required
        if (secType === "none") {
            return { valid: true, message: "" };
        }

        // Editing existing connection - empty password keeps existing
        if (!value && connection) {
            return { valid: true, message: "" };
        }

        // WPA/WPA2/WPA3 requirements
        if (!value || value.length === 0) {
            return { valid: false, message: _("Password is required for secure Access Point") };
        }
        if (value.length < 8) {
            return { valid: false, message: _("Password must be at least 8 characters") };
        }
        if (value.length > 63) {
            return { valid: false, message: _("Password must not exceed 63 characters") };
        }
        return { valid: true, message: "" };
    };

    // Validate IP address
    const validateIP = (ip) => {
        if (!ip || ip.trim() === "") {
            return { valid: false, message: _("IP address cannot be empty") };
        }
        // Basic IPv4 validation
        const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (!ipPattern.test(ip)) {
            return { valid: false, message: _("Invalid IP address format") };
        }
        const parts = ip.split('.');
        for (const part of parts) {
            const num = parseInt(part);
            if (num < 0 || num > 255) {
                return { valid: false, message: _("IP address octets must be 0-255") };
            }
        }
        return { valid: true, message: "" };
    };

    const ssidValidation = validateSSID(ssid);
    const passwordValidation = validatePassword(password, securityType);
    const ipValidation = validateIP(ipAddress);
    const isFormValid = ssidValidation.valid && passwordValidation.valid && ipValidation.valid;

    const onSubmit = (ev) => {
        if (ev) {
            ev.preventDefault();
        }

        // Validate all fields
        if (!isFormValid) {
            setDialogError(ssidValidation.message || passwordValidation.message || ipValidation.message);
            return;
        }

        // Build Access Point connection settings
        const apSettings = {
            ...settings,
            connection: {
                ...settings.connection,
                id: ssid,
                type: "802-11-wireless",
                uuid: settings.connection.uuid || uuidv4(),
                interface_name: iface,
                autoconnect: false, // Manual activation for AP
            },
            wifi: {
                ssid,
                mode: "ap",
                band,
                ...(channel !== 0 && { channel }), // Only include if not auto
                ...(hidden && { hidden: true }), // Only include if hidden
            },
            ipv4: {
                method: "shared", // Enables DHCP server
                address_data: [{ address: ipAddress, prefix: parseInt(prefix) }],
            },
            ipv6: {
                method: "ignore",
            },
        };

        // Add security if not open network
        if (securityType !== "none") {
            if (!password && !connection) {
                setDialogError(_("Password required for secure Access Point"));
                return;
            }

            apSettings.wifi_security = {
                key_mgmt: securityType,
            };

            // Only set password if provided (for new or when changing)
            if (password) {
                apSettings.wifi_security.psk = password;
            }
        } else {
            // Open network - no security
            apSettings.wifi_security = null;
        }

        dialogSave({
            model,
            dev,
            connection,
            settings: apSettings,
            setDialogError,
            onClose: () => {
                // Clear password from memory
                setPassword("");
                Dialogs.close();
            },
        });
    };

    return (
        <NetworkModal
            id={idPrefix + "-dialog"}
            title={isCreateDialog ? _("Enable Access Point") : _("Edit Access Point")}
            dialogError={dialogError}
            onSubmit={onSubmit}
            isCreateDialog={isCreateDialog}
        >
            <Form isHorizontal onSubmit={onSubmit}>
                <Name
                    idPrefix={idPrefix}
                    iface={iface}
                    setIface={setIface}
                />

                <FormGroup label={_("Network name (SSID)")} fieldId={idPrefix + "-ssid-input"} isRequired>
                    <TextInput
                        id={idPrefix + "-ssid-input"}
                        value={ssid}
                        onChange={(_, val) => setSSID(val)}
                        validated={ssid && !ssidValidation.valid ? "error" : "default"}
                        isRequired
                    />
                    {ssid && !ssidValidation.valid && (
                        <FormHelperText>
                            <HelperText>
                                <HelperTextItem variant="error">
                                    {ssidValidation.message}
                                </HelperTextItem>
                            </HelperText>
                        </FormHelperText>
                    )}
                    {(!ssid || ssidValidation.valid) && (
                        <FormHelperText>
                            <HelperText>
                                <HelperTextItem>
                                    {_("Default: HALOS-{last 4 chars of MAC address}")}
                                </HelperTextItem>
                            </HelperText>
                        </FormHelperText>
                    )}
                </FormGroup>

                <FormGroup label={_("Security")} fieldId={idPrefix + "-security-select"}>
                    <select
                        id={idPrefix + "-security-select"}
                        className="pf-v6-c-form-control"
                        value={securityType}
                        onChange={(e) => setSecurityType(e.target.value)}
                    >
                        <option value="wpa-psk">{_("WPA2 (Recommended)")}</option>
                        <option value="none">{_("Open (No Security)")}</option>
                    </select>
                </FormGroup>

                {securityType !== "none" && (
                    <FormGroup label={_("Password")} fieldId={idPrefix + "-password-input"} isRequired>
                        <TextInput
                            id={idPrefix + "-password-input"}
                            type="password"
                            value={password}
                            onChange={(_, val) => setPassword(val)}
                            placeholder={connection ? _("Leave empty to keep existing password") : _("Enter password")}
                            validated={password && !passwordValidation.valid ? "error" : "default"}
                        />
                        {password && !passwordValidation.valid && (
                            <FormHelperText>
                                <HelperText>
                                    <HelperTextItem variant="error">
                                        {passwordValidation.message}
                                    </HelperTextItem>
                                </HelperText>
                            </FormHelperText>
                        )}
                        {(!password && !connection) && (
                            <FormHelperText>
                                <HelperText>
                                    <HelperTextItem>
                                        {_("Password must be 8-63 characters for WPA2")}
                                    </HelperTextItem>
                                </HelperText>
                            </FormHelperText>
                        )}
                    </FormGroup>
                )}

                {securityType === "none" && (
                    <Alert
                        variant="warning"
                        isInline
                        title={_("Security Warning")}
                    >
                        <p>
                            {_("An open Access Point allows anyone to connect without a password.")}
                        </p>
                        <p>
                            {_("This is not recommended for security reasons.")}
                        </p>
                    </Alert>
                )}

                <FormGroup label={_("Frequency Band")} fieldId={idPrefix + "-band-select"}>
                    <select
                        id={idPrefix + "-band-select"}
                        className="pf-v6-c-form-control"
                        value={band}
                        onChange={(e) => setBand(e.target.value)}
                    >
                        <option value="bg">{_("2.4 GHz")}</option>
                        <option value="a">{_("5 GHz")}</option>
                    </select>
                    <FormHelperText>
                        <HelperText>
                            <HelperTextItem>
                                {_("2.4 GHz provides better range, 5 GHz provides faster speeds")}
                            </HelperTextItem>
                        </HelperText>
                    </FormHelperText>
                </FormGroup>

                <FormGroup label={_("Channel")} fieldId={idPrefix + "-channel-select"}>
                    <select
                        id={idPrefix + "-channel-select"}
                        className="pf-v6-c-form-control"
                        value={channel}
                        onChange={(e) => setChannel(parseInt(e.target.value))}
                    >
                        <option value="0">{_("Automatic")}</option>
                        {band === "bg" && [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(ch => (
                            <option key={ch} value={ch}>{ch}</option>
                        ))}
                        {band === "a" && [36, 40, 44, 48, 149, 153, 157, 161, 165].map(ch => (
                            <option key={ch} value={ch}>{ch}</option>
                        ))}
                    </select>
                    <FormHelperText>
                        <HelperText>
                            <HelperTextItem>
                                {_("Leave as Automatic unless experiencing interference")}
                            </HelperTextItem>
                        </HelperText>
                    </FormHelperText>
                </FormGroup>

                <FormGroup>
                    <Checkbox
                        id={idPrefix + "-hidden-checkbox"}
                        label={_("Hidden network (don't broadcast SSID)")}
                        isChecked={hidden}
                        onChange={(_, checked) => setHidden(checked)}
                    />
                    <FormHelperText>
                        <HelperText>
                            <HelperTextItem>
                                {_("Clients will need to manually enter the network name")}
                            </HelperTextItem>
                        </HelperText>
                    </FormHelperText>
                </FormGroup>

                <FormGroup label={_("IP Address")} fieldId={idPrefix + "-ip-input"}>
                    <TextInput
                        id={idPrefix + "-ip-input"}
                        value={ipAddress}
                        onChange={(_, val) => setIPAddress(val)}
                        validated={ipAddress && !ipValidation.valid ? "error" : "default"}
                    />
                    {ipAddress && !ipValidation.valid && (
                        <FormHelperText>
                            <HelperText>
                                <HelperTextItem variant="error">
                                    {ipValidation.message}
                                </HelperTextItem>
                            </HelperText>
                        </FormHelperText>
                    )}
                    {(!ipAddress || ipValidation.valid) && (
                        <FormHelperText>
                            <HelperText>
                                <HelperTextItem>
                                    {_("Default: 10.42.0.1")}
                                </HelperTextItem>
                            </HelperText>
                        </FormHelperText>
                    )}
                </FormGroup>

                <FormGroup label={_("Subnet Prefix")} fieldId={idPrefix + "-prefix-input"}>
                    <TextInput
                        id={idPrefix + "-prefix-input"}
                        type="number"
                        value={prefix}
                        onChange={(_, val) => setPrefix(val)}
                        min="1"
                        max="32"
                    />
                    <FormHelperText>
                        <HelperText>
                            <HelperTextItem>
                                {_("Default: 24 (255.255.255.0, supports 254 clients)")}
                            </HelperTextItem>
                        </HelperText>
                    </FormHelperText>
                </FormGroup>
            </Form>
        </NetworkModal>
    );
};

// Helper function to get MAC address from device
function getMACAddress(dev) {
    return dev?.HwAddress || "";
}

// Helper function to generate default SSID for Access Point
function generateDefaultSSID(dev) {
    const mac = getMACAddress(dev);
    if (!mac) return "HALOS-AP";

    // Clean MAC address (remove colons) and validate length
    const macClean = mac.replace(/:/g, '').toUpperCase();
    if (macClean.length < 4) return "HALOS-AP";

    // Get last 4 characters of MAC address
    const macSuffix = macClean.slice(-4);
    return `HALOS-${macSuffix}`;
}

// Ghost settings for "Add WiFi" action (Client mode)
export function getWiFiGhostSettings({ newIfaceName }) {
    return {
        connection: {
            id: "",
            type: "802-11-wireless",
            interface_name: newIfaceName || "",
            autoconnect: true,
            uuid: "",
        },
        wifi: {
            ssid: "",
            mode: "infrastructure",
        },
        ipv4: { method: "auto" },
        ipv6: { method: "auto" },
    };
}

// Ghost settings for Access Point mode
export function getWiFiAPGhostSettings({ newIfaceName, dev }) {
    return {
        connection: {
            id: generateDefaultSSID(dev),
            type: "802-11-wireless",
            interface_name: newIfaceName || (dev && dev.Interface) || "",
            autoconnect: false, // Manual activation for AP
            uuid: "",
        },
        wifi: {
            ssid: generateDefaultSSID(dev),
            mode: "ap",
            band: "bg", // 2.4GHz default
        },
        wifi_security: {
            key_mgmt: "wpa-psk",
            psk: "", // User must set password
        },
        ipv4: {
            method: "shared", // Enables DHCP server
            address_data: [{ address: "10.42.0.1", prefix: 24 }],
        },
        ipv6: {
            method: "ignore",
        },
    };
}

// Open Network Warning Dialog
const OpenNetworkWarningDialog = ({ ap, onProceed, onCancel }) => {
    return (
        <NetworkModal
            id="open-network-warning-dialog"
            title={_("Unsecured Network")}
            onSubmit={onProceed}
            submitLabel={_("Connect Anyway")}
            isCreateDialog
        >
            <Alert
                variant="warning"
                isInline
                title={_("Security Warning")}
            >
                <p>
                    {cockpit.format(_("The network \"$0\" is not secured."), ap.ssid)}
                </p>
                <p>
                    {_("Your data will be transmitted unencrypted and could be intercepted by others.")}
                </p>
            </Alert>
        </NetworkModal>
    );
};

// WiFi AP Client List Component
const WiFiAPClientList = ({ iface }) => {
    const [clients, setClients] = useState([]);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!iface) return;

        const leasePath = `/var/lib/NetworkManager/dnsmasq-${iface}.leases`;
        const file = cockpit.file(leasePath, { superuser: "try" });

        const handleContent = (content) => {
            if (!content || content.trim() === "") {
                setClients([]);
                setError(null);
                return;
            }

            try {
                const lines = content.trim().split('\n');
                const parsed = lines.map(line => {
                    const parts = line.split(' ');
                    return {
                        timestamp: parts[0],
                        mac: parts[1] || "",
                        ip: parts[2] || "",
                        hostname: parts[3] || _("Unknown"),
                        clientId: parts[4] || "",
                    };
                }).filter(client => client.ip); // Filter out invalid entries

                setClients(parsed);
                setError(null);
            } catch (err) {
                console.error("Error parsing DHCP leases:", err);
                setClients([]);
                setError(_("Failed to parse client list"));
            }
        };

        const handleError = (err) => {
            // File not existing is not an error - just means no DHCP server running yet
            if (err.problem === "not-found") {
                setClients([]);
                setError(null);
            } else {
                console.error("Error reading DHCP leases:", err);
                setClients([]);
                setError(_("Unable to read client list"));
            }
        };

        file.watch(handleContent, { err: handleError });

        return () => file.close();
    }, [iface]);

    if (error) {
        return (
            <Alert variant="warning" isInline title={error} />
        );
    }

    if (clients.length === 0) {
        return (
            <EmptyState>
                <EmptyStateBody>{_("No clients connected")}</EmptyStateBody>
            </EmptyState>
        );
    }

    return (
        <Table variant="compact">
            <Thead>
                <Tr>
                    <Th>{_("Client")}</Th>
                    <Th>{_("IP Address")}</Th>
                    <Th>{_("MAC Address")}</Th>
                </Tr>
            </Thead>
            <Tbody>
                {clients.map((client, idx) => (
                    <Tr key={client.mac || idx}>
                        <Td>{client.hostname}</Td>
                        <Td>{client.ip}</Td>
                        <Td>{client.mac}</Td>
                    </Tr>
                ))}
            </Tbody>
        </Table>
    );
};

// WiFi AP Configuration Status Component
export const WiFiAPConfig = ({ dev, connection, onDisable, onConfigure }) => {
    const settings = connection?.Settings;
    const ssid = settings?.wifi?.ssid || _("Unknown");
    const security = settings?.wifi_security?.key_mgmt ? "WPA2" : _("Open");
    const ipConfig = settings?.ipv4?.address_data?.[0] || { address: "10.42.0.1", prefix: 24 };

    return (
        <Card>
            <CardHeader actions={{
                actions: (
                    <>
                        <Button variant="secondary" onClick={onConfigure}>
                            {_("Configure")}
                        </Button>
                        <Button variant="danger" onClick={onDisable}>
                            {_("Disable")}
                        </Button>
                    </>
                )
            }}>
                <CardTitle>{_("Access Point")}</CardTitle>
            </CardHeader>
            <CardBody>
                <DescriptionList isHorizontal>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Status")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            <Label color="green">{_("Active")}</Label>
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("SSID")}</DescriptionListTerm>
                        <DescriptionListDescription>{ssid}</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Security")}</DescriptionListTerm>
                        <DescriptionListDescription>{security}</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("IP Range")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            {ipConfig.address}/{ipConfig.prefix}
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Connected Clients")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            <WiFiAPClientList iface={dev?.Interface} />
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                </DescriptionList>
            </CardBody>
        </Card>
    );
};

// Helper function to detect WiFi mode
function getWiFiMode(dev) {
    const activeConn = dev?.ActiveConnection;
    if (!activeConn) return "inactive";

    const settings = activeConn.Settings;
    if (settings?.connection?.type !== "802-11-wireless") return "other";

    const mode = settings.wifi?.mode;
    if (mode === "ap") return "ap";
    if (mode === "infrastructure") return "client";
    return "unknown";
}

// WiFi Page Component (for future use with dedicated WiFi management page)
export const WiFiPage = ({ iface, dev }) => {
    const model = useContext(ModelContext);
    const Dialogs = useDialogs();
    const [scanning, setScanning] = useState(false);
    const [accessPoints, setAccessPoints] = useState([]);
    const [error, setError] = useState(null);
    const [mode, setMode] = useState("inactive");
    const [apConnection, setAPConnection] = useState(null);
    const fetchRequestIdRef = useRef(0); // Track fetch requests to handle race conditions

    // Fetch access points from device
    const fetchAccessPoints = useCallback(async () => {
        const devPath = dev?.[" priv"]?.path;
        if (!dev || !devPath) {
            return;
        }

        // Increment request ID to track this fetch
        const requestId = ++fetchRequestIdRef.current;

        try {
            // Get AccessPoints property instead of calling deprecated GetAccessPoints method
            const apPathsResult = await model.client.call(
                devPath,
                "org.freedesktop.DBus.Properties",
                "Get",
                ["org.freedesktop.NetworkManager.Device.Wireless", "AccessPoints"]
            );

            // Check if this request is still valid (not superseded by a newer one)
            if (requestId !== fetchRequestIdRef.current) {
                return; // Ignore stale response
            }

            const apPaths = apPathsResult[0].v; // Extract array from variant

            const aps = await Promise.all(
                apPaths.map(async (apPath) => {
                    const props = await model.client.call(
                        apPath,
                        "org.freedesktop.DBus.Properties",
                        "GetAll",
                        ["org.freedesktop.NetworkManager.AccessPoint"]
                    );

                    const propsObj = props[0];
                    const ssid = decode_nm_property(propsObj.Ssid.v);

                    return {
                        path: apPath,
                        ssid,
                        strength: propsObj.Strength.v,
                        frequency: propsObj.Frequency.v,
                        security: parseSecurityFlags(
                            propsObj.Flags.v,
                            propsObj.WpaFlags.v,
                            propsObj.RsnFlags.v
                        ),
                    };
                })
            );

            // Final check before updating state
            if (requestId === fetchRequestIdRef.current) {
                setAccessPoints(aps);
                setError(null);
            }
        } catch (err) {
            // Only update error if this is still the latest request
            if (requestId === fetchRequestIdRef.current) {
                console.error("Failed to fetch access points:", err);
                setError(_("Failed to retrieve WiFi networks. Please try scanning again."));
            }
        }
    }, [dev, model.client]);

    // Wait for scan completion by polling LastScan property
    const waitForScanCompletion = useCallback(async (devPath, initialLastScan) => {
        const maxAttempts = 20; // 20 * 500ms = 10 seconds max
        const pollInterval = 500; // Poll every 500ms

        for (let i = 0; i < maxAttempts; i++) {
            await new Promise(resolve => setTimeout(resolve, pollInterval));

            try {
                const lastScanResult = await model.client.call(
                    devPath,
                    "org.freedesktop.DBus.Properties",
                    "Get",
                    ["org.freedesktop.NetworkManager.Device.Wireless", "LastScan"]
                );

                const lastScan = lastScanResult[0].v;

                // If LastScan timestamp has changed, scan is complete
                if (lastScan !== initialLastScan) {
                    return true;
                }
            } catch (err) {
                console.error("Error polling LastScan:", err);
                // Continue polling despite error
            }
        }

        // Timeout reached
        return false;
    }, [model.client]);

    // Trigger network scan
    const handleScan = useCallback(async () => {
        setScanning(true);
        setError(null);

        try {
            const devPath = dev?.[" priv"]?.path;
            if (!devPath) {
                throw new Error("Device path not available");
            }

            // Get current LastScan timestamp before requesting scan
            const initialLastScanResult = await model.client.call(
                devPath,
                "org.freedesktop.DBus.Properties",
                "Get",
                ["org.freedesktop.NetworkManager.Device.Wireless", "LastScan"]
            );
            const initialLastScan = initialLastScanResult[0].v;

            // Request an active scan with empty options dict
            await model.client.call(
                devPath,
                "org.freedesktop.NetworkManager.Device.Wireless",
                "RequestScan",
                [{}]
            );

            // Wait for scan to complete
            const scanCompleted = await waitForScanCompletion(devPath, initialLastScan);

            if (!scanCompleted) {
                console.warn("Scan timeout reached, fetching APs anyway");
            }

            // Fetch updated access points
            await fetchAccessPoints();
        } catch (err) {
            console.error("WiFi scan failed:", err);
            setError(_("WiFi scan failed. Please try again."));
            // Still try to fetch APs even if scan failed
            await fetchAccessPoints();
        } finally {
            setScanning(false);
        }
    }, [dev, model.client, waitForScanCompletion, fetchAccessPoints]);

    // Connect to network
    const handleConnect = useCallback((ap) => {
        if (ap.security === "open") {
            // Show warning dialog for open networks
            Dialogs.show(
                <OpenNetworkWarningDialog
                    ap={ap}
                    onProceed={() => {
                        Dialogs.close();
                        const settings = getWiFiGhostSettings({ newIfaceName: dev.Interface });
                        Dialogs.show(<WiFiConnectDialog settings={settings} dev={dev} ap={ap} />);
                    }}
                    onCancel={() => Dialogs.close()}
                />
            );
        } else {
            const settings = getWiFiGhostSettings({ newIfaceName: dev.Interface });
            Dialogs.show(<WiFiConnectDialog settings={settings} dev={dev} ap={ap} />);
        }
    }, [dev, Dialogs]);

    // Enable Access Point
    const handleEnableAP = useCallback(() => {
        const settings = getWiFiAPGhostSettings({ newIfaceName: dev.Interface, dev });
        Dialogs.show(<WiFiAPDialog settings={settings} dev={dev} />);
    }, [dev, Dialogs]);

    // Disable Access Point
    const handleDisableAP = useCallback(async () => {
        if (!apConnection) return;

        try {
            await model.client.call(
                "/org/freedesktop/NetworkManager",
                "org.freedesktop.NetworkManager",
                "DeactivateConnection",
                [apConnection[" priv"].path]
            );
        } catch (err) {
            console.error("Failed to disable AP:", err);
            setError(_("Failed to disable Access Point: ") + err.message);
        }
    }, [model, apConnection]);

    // Configure Access Point
    const handleConfigureAP = useCallback(() => {
        if (!apConnection) return;
        Dialogs.show(<WiFiAPDialog settings={apConnection.Settings} connection={apConnection} dev={dev} />);
    }, [apConnection, dev, Dialogs]);

    // Detect current WiFi mode
    useEffect(() => {
        const currentMode = getWiFiMode(dev);
        setMode(currentMode);

        if (currentMode === "ap") {
            setAPConnection(dev.ActiveConnection);
        } else {
            setAPConnection(null);
        }
    }, [dev, dev?.ActiveConnection]);

    // Auto-scan on mount (only in client mode)
    useEffect(() => {
        if (mode !== "ap" && dev && dev[" priv"]?.path) {
            fetchAccessPoints();
        }
    }, [dev, fetchAccessPoints, mode]);

    // Show AP status card if in AP mode
    if (mode === "ap") {
        return (
            <WiFiAPConfig
                dev={dev}
                connection={apConnection}
                onDisable={handleDisableAP}
                onConfigure={handleConfigureAP}
            />
        );
    }

    // Show client mode UI (scanning and connecting)
    return (
        <Card>
            <CardHeader>
                <CardTitle>{_("WiFi Networks")}</CardTitle>
                <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                    <FlexItem>
                        <Button onClick={handleScan} isDisabled={scanning}>
                            {scanning ? _("Scanning...") : _("Scan")}
                        </Button>
                    </FlexItem>
                    <FlexItem>
                        <Button variant="secondary" onClick={handleEnableAP}>
                            {_("Enable Access Point")}
                        </Button>
                    </FlexItem>
                </Flex>
            </CardHeader>
            <CardBody>
                {error && (
                    <Alert
                        variant="danger"
                        isInline
                        title={error}
                        style={{ marginBottom: "1rem" }}
                    />
                )}
                <WiFiNetworkList
                    accessPoints={accessPoints}
                    onConnect={handleConnect}
                    scanning={scanning}
                />
            </CardBody>
        </Card>
    );
};
