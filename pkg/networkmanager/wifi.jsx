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

import cockpit from 'cockpit';
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';

import { Alert } from '@patternfly/react-core/dist/esm/components/Alert/index.js';
import { Badge } from '@patternfly/react-core/dist/esm/components/Badge/index.js';
import { Button } from '@patternfly/react-core/dist/esm/components/Button/index.js';
import { Card, CardBody, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Checkbox } from '@patternfly/react-core/dist/esm/components/Checkbox/index.js';
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from '@patternfly/react-core/dist/esm/components/DescriptionList/index.js';
import { EmptyState, EmptyStateBody } from '@patternfly/react-core/dist/esm/components/EmptyState/index.js';
import { Form, FormGroup, FormHelperText } from '@patternfly/react-core/dist/esm/components/Form/index.js';
import { HelperText, HelperTextItem } from '@patternfly/react-core/dist/esm/components/HelperText/index.js';
import { Label } from '@patternfly/react-core/dist/esm/components/Label/index.js';
import { List, ListItem } from '@patternfly/react-core/dist/esm/components/List/index.js';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@patternfly/react-core/dist/esm/components/Modal/index.js';
import { TextInput } from '@patternfly/react-core/dist/esm/components/TextInput/index.js';
import { Tooltip } from '@patternfly/react-core/dist/esm/components/Tooltip/index.js';
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { DragDropSort } from '@patternfly/react-drag-drop';
import { GripVerticalIcon, OutlinedQuestionCircleIcon } from '@patternfly/react-icons';
import { useDialogs } from 'dialogs.jsx';
import { v4 as uuidv4 } from 'uuid';
import { Name, NetworkModal, dialogSave } from "./dialogs-common";
import { ModelContext } from './model-context';
import { decode_nm_property } from './utils';

const _ = cockpit.gettext;

// NetworkManager device state constants
const NM_DEVICE_STATE_UNAVAILABLE = 20;

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
    if (accessPoints.length === 0 && !scanning) {
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

        // For new WiFi connections, use AddAndActivateConnection to create AND connect
        // For existing connections, use dialogSave to update settings
        if (!connection) {
            // New connection - use activate_with_settings which calls AddAndActivateConnection
            model.set_operation_in_progress(true);
            dev.activate_with_settings(wifiSettings, null)
                    .then(() => {
                        setPassword("");
                        Dialogs.close();
                    })
                    .catch(ex => setDialogError(typeof ex === 'string' ? ex : ex.message))
                    .finally(() => model.set_operation_in_progress(false));
        } else {
            // Editing existing connection - use dialogSave
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
        }
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
export const WiFiAPDialog = ({ settings, connection, dev, dualMode = false }) => {
    const Dialogs = useDialogs();
    const model = useContext(ModelContext);
    const idPrefix = "network-wifi-ap";

    // Safely access settings with fallbacks
    const safeSettings = settings || {};
    const [iface, setIface] = useState(safeSettings.connection?.interface_name || (dev && dev.Interface) || "");
    const [ssid, setSSID] = useState(safeSettings.wifi?.ssid || generateDefaultSSID(dev));
    const [password, setPassword] = useState("");
    const [securityType, setSecurityType] = useState(safeSettings.wifi_security?.key_mgmt || "wpa-psk");
    const [band, setBand] = useState(safeSettings.wifi?.band || "bg");
    const [channel, setChannel] = useState(safeSettings.wifi?.channel || 0);
    const [hidden, setHidden] = useState(safeSettings.wifi?.hidden || false);
    const [ipAddress, setIPAddress] = useState(safeSettings.ipv4?.address_data?.[0]?.address || "10.42.0.1");
    const [prefix, setPrefix] = useState(safeSettings.ipv4?.address_data?.[0]?.prefix || 24);
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

    // Helper to create virtual interface for dual mode
    const createVirtualInterface = async (mainIface, apIface) => {
        try {
            // Check if already exists
            const check = await cockpit.spawn(["ip", "link", "show", apIface], { err: "ignore" });
            if (check && check.includes(apIface)) {
                return { success: true };
            }
        } catch {
            // Doesn't exist, create it
        }

        try {
            await cockpit.spawn(
                ["/usr/sbin/iw", "dev", mainIface, "interface", "add", apIface, "type", "__ap"],
                { superuser: "require", err: "message" }
            );
            await cockpit.spawn(
                ["ip", "link", "set", apIface, "up"],
                { superuser: "require", err: "message" }
            );
            // Wait for NetworkManager to detect the new interface
            // This is critical - NM needs ~3 seconds to see the new interface
            await new Promise(resolve => setTimeout(resolve, 3000));
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message || String(err) };
        }
    };

    const onSubmit = async (ev) => {
        if (ev) {
            ev.preventDefault();
        }

        // Validate all fields
        if (!isFormValid) {
            setDialogError(ssidValidation.message || passwordValidation.message || ipValidation.message);
            return;
        }

        // For dual mode, create the virtual interface right before activation
        // Detect AP interface by checking if it ends with "ap" (e.g., wlan0ap)
        const isAPInterface = iface.endsWith("ap");
        if (dualMode && isAPInterface) {
            const mainIface = dev.Interface;
            const result = await createVirtualInterface(mainIface, iface);
            if (!result.success) {
                setDialogError(_("Failed to create virtual interface: ") + result.error);
                return;
            }
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
                address_data: [{ address: ipAddress, prefix: String(prefix) }],
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

        // For new AP connections, use AddAndActivateConnection to create AND activate
        // For existing connections, use dialogSave to update settings
        if (!connection) {
            model.set_operation_in_progress(true);

            // For dual mode, we need to use nmcli directly since we're activating on a different interface
            if (dualMode && isAPInterface) {
                try {
                    // Create new connection with nmcli dynamically
                    // Connection name uses the SSID (e.g., hostname-B782)
                    const args = [
                        "connection", "add",
                        "type", "wifi",
                        "ifname", iface,
                        "con-name", ssid,
                        "autoconnect", "no",
                        "ssid", ssid,
                        "mode", "ap",
                        "ipv4.method", "shared",
                        "ipv4.addresses", `${ipAddress}/${prefix}`,
                        "wifi.band", band,
                    ];

                    if (channel !== 0) {
                        args.push("wifi.channel", String(channel));
                    }

                    if (securityType !== "none" && password) {
                        args.push("wifi-sec.key-mgmt", securityType);
                        args.push("wifi-sec.psk", password);
                    }

                    await cockpit.spawn(["nmcli", ...args], { superuser: "require", err: "message" });

                    // Activate the connection on the specific AP interface
                    await cockpit.spawn(
                        ["nmcli", "connection", "up", ssid, "ifname", iface],
                        { superuser: "require", err: "message" }
                    );

                    setPassword("");
                    Dialogs.close();
                } catch (ex) {
                    setDialogError(typeof ex === 'string' ? ex : ex.message);
                } finally {
                    model.set_operation_in_progress(false);
                }
            } else {
                // Normal single-mode: use activate_with_settings
                dev.activate_with_settings(apSettings, null)
                        .then(() => {
                            setPassword("");
                            Dialogs.close();
                        })
                        .catch(ex => setDialogError(typeof ex === 'string' ? ex : ex.message))
                        .finally(() => model.set_operation_in_progress(false));
            }
        } else {
            // Editing existing AP - use dialogSave
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
        }
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
                                    {_("Default: {hostname}-{last 4 chars of MAC}")}
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
// Uses system hostname with MAC suffix for uniqueness
function generateDefaultSSID(dev) {
    const mac = getMACAddress(dev);
    // Get hostname, fallback to generic prefix if not available
    const hostname = cockpit.localStorage.getItem("HostnameOverride") ||
                     window.location.hostname?.split('.')[0] ||
                     "WiFi";

    if (!mac) return `${hostname}-AP`;

    // Clean MAC address (remove colons) and validate length
    const macClean = mac.replace(/:/g, '').toUpperCase();
    if (macClean.length < 4) return `${hostname}-AP`;

    // Get last 4 characters of MAC address for uniqueness
    const macSuffix = macClean.slice(-4);
    return `${hostname}-${macSuffix}`;
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

// Hidden Network Dialog
const WiFiHiddenDialog = ({ dev }) => {
    const Dialogs = useDialogs();
    const [ssid, setSSID] = useState("");
    const [security, setSecurity] = useState("wpa2");

    const onSubmit = (ev) => {
        if (ev) {
            ev.preventDefault();
        }

        // Create a synthetic AP object for the hidden network
        const hiddenAP = {
            ssid,
            security,
            strength: 0,
            path: null, // No actual AP path for hidden networks
        };

        // Close this dialog and show the WiFi connect dialog
        Dialogs.close();

        // Show warning for open networks, otherwise go straight to connect dialog
        if (security === "open") {
            Dialogs.show(
                <OpenNetworkWarningDialog
                    ap={hiddenAP}
                    onProceed={() => {
                        Dialogs.close();
                        const settings = getWiFiGhostSettings({ newIfaceName: dev.Interface });
                        Dialogs.show(<WiFiConnectDialog settings={settings} dev={dev} ap={hiddenAP} />);
                    }}
                    onCancel={() => Dialogs.close()}
                />
            );
        } else {
            const settings = getWiFiGhostSettings({ newIfaceName: dev.Interface });
            Dialogs.show(<WiFiConnectDialog settings={settings} dev={dev} ap={hiddenAP} />);
        }
    };

    return (
        <NetworkModal
            id="wifi-hidden-network-dialog"
            title={_("Connect to Hidden Network")}
            onSubmit={onSubmit}
            isCreateDialog
            submitDisabled={!ssid || ssid.trim() === "" || ssid.length > 32}
        >
            <Form isHorizontal onSubmit={onSubmit}>
                <FormGroup
                    label={_("Network name (SSID)")}
                    fieldId="wifi-hidden-ssid-input"
                    isRequired
                    helperTextInvalid={ssid.length > 32 ? _("SSID must be 32 characters or less") : ""}
                    validated={ssid.length > 32 ? "error" : "default"}
                >
                    <TextInput
                        id="wifi-hidden-ssid-input"
                        value={ssid}
                        onChange={(_, val) => setSSID(val)}
                        placeholder={_("Enter network name")}
                        isRequired
                        validated={ssid.length > 32 ? "error" : "default"}
                    />
                </FormGroup>

                <FormGroup label={_("Security")} fieldId="wifi-hidden-security-select">
                    <select
                        id="wifi-hidden-security-select"
                        className="pf-v6-c-form-control"
                        value={security}
                        onChange={(e) => setSecurity(e.target.value)}
                    >
                        <option value="wpa3">{_("WPA3")}</option>
                        <option value="wpa2">{_("WPA2")}</option>
                        <option value="wpa">{_("WPA")}</option>
                        <option value="open">{_("Open (No Security)")}</option>
                    </select>
                </FormGroup>
            </Form>
        </NetworkModal>
    );
};

// Saved Networks List Component
const WiFiSavedNetworks = ({ dev, model }) => {
    const [savedNetworks, setSavedNetworks] = useState([]);
    const [error, setError] = useState(null);

    // Get saved WiFi connections with subscription to model changes
    useEffect(() => {
        if (!model) return;

        const updateSavedNetworks = () => {
            const settings = model.get_settings();
            if (!settings || !settings.Connections) {
                setSavedNetworks([]);
                return;
            }

            // Filter for WiFi client connections (exclude AP mode)
            const wifiConnections = settings.Connections.filter(con => {
                const conSettings = con.Settings;
                if (!conSettings || conSettings.connection?.type !== "802-11-wireless") return false;
                const mode = conSettings.wifi?.mode || conSettings["802-11-wireless"]?.mode?.v;
                return mode !== "ap";
            });

            // Sort by autoconnect-priority (highest first)
            const sorted = [...wifiConnections].sort((a, b) => {
                const priorityA = a.Settings.connection?.['autoconnect-priority'] ?? 0;
                const priorityB = b.Settings.connection?.['autoconnect-priority'] ?? 0;
                return priorityB - priorityA;
            });

            setSavedNetworks(sorted);
        };

        updateSavedNetworks();
        model.addEventListener("changed", updateSavedNetworks);
        return () => model.removeEventListener("changed", updateSavedNetworks);
    }, [model]);

    const handleConnect = useCallback(async (connection) => {
        if (!dev || !connection) return;

        try {
            setError(null);
            await connection.activate(dev, null);
        } catch (err) {
            console.error("Failed to connect to saved network:", err);
            setError(cockpit.format(_("Failed to connect to \"$0\": $1"),
                                    connection.Settings.connection?.id || _("Unknown"),
                                    err.message));
        }
    }, [dev]);

    const handleForget = useCallback(async (connection) => {
        if (!connection) return;

        try {
            setError(null);
            await connection.delete_();
        } catch (err) {
            console.error("Failed to forget network:", err);
            setError(cockpit.format(_("Failed to forget \"$0\": $1"),
                                    connection.Settings.connection?.id || _("Unknown"),
                                    err.message));
        }
    }, []);

    // Handle drag-drop reorder: update autoconnect-priority for all affected items
    const handleReorder = useCallback(async (newItems) => {
        try {
            setError(null);
            // Assign priorities based on new order (highest priority = list length, decreasing)
            const updates = newItems.map((item, index) => {
                const connection = item.connection;
                const newPriority = newItems.length - index;
                return connection.update({
                    ...connection.Settings,
                    connection: { ...connection.Settings.connection, 'autoconnect-priority': newPriority },
                });
            });
            await Promise.all(updates);
        } catch (err) {
            setError(cockpit.format(_("Failed to change priority: $0"), err.message));
        }
    }, []);

    if (savedNetworks.length === 0) {
        return (
            <Card style={{ marginTop: "1rem" }}>
                <CardHeader>
                    <CardTitle>{_("Saved Networks")}</CardTitle>
                </CardHeader>
                <CardBody>
                    <EmptyState variant="sm">
                        <EmptyStateBody>
                            {_("No saved networks. Connect to a WiFi network to save it.")}
                        </EmptyStateBody>
                    </EmptyState>
                </CardBody>
            </Card>
        );
    }

    // Build draggable items for DragDropSort
    const draggableItems = savedNetworks.map((connection) => {
        const ssid = connection.Settings.wifi?.ssid ||
                    connection.Settings["802-11-wireless"]?.ssid?.v ||
                    connection.Settings.connection?.id ||
                    _("Unknown");
        const isActive = dev?.ActiveConnection?.Connection?.[" priv"]?.path === connection[" priv"]?.path;

        return {
            id: connection[" priv"].path,
            connection, // Store connection reference for reorder handler
            content: (
                <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }} style={{ width: "100%" }}>
                    <FlexItem>
                        <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
                            <FlexItem>
                                <GripVerticalIcon style={{ cursor: "grab", color: "var(--pf-v5-global--Color--200)" }} />
                            </FlexItem>
                            <FlexItem>
                                <span>{ssid}</span>
                                {isActive && (
                                    <Label color="blue" style={{ marginLeft: "0.5rem" }}>
                                        {_("Connected")}
                                    </Label>
                                )}
                            </FlexItem>
                        </Flex>
                    </FlexItem>
                    <FlexItem>
                        <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                            {!isActive && (
                                <FlexItem>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => handleConnect(connection)}
                                    >
                                        {_("Connect")}
                                    </Button>
                                </FlexItem>
                            )}
                            <FlexItem>
                                <Button
                                    variant="link"
                                    isDanger
                                    size="sm"
                                    onClick={() => handleForget(connection)}
                                >
                                    {_("Forget")}
                                </Button>
                            </FlexItem>
                        </Flex>
                    </FlexItem>
                </Flex>
            ),
        };
    });

    return (
        <Card style={{ marginTop: "1rem" }}>
            <CardHeader>
                <CardTitle>
                    {_("Saved Networks")}
                    <Tooltip content={_("Drag to reorder. Networks are connected in priority order (top = highest).")}>
                        <OutlinedQuestionCircleIcon style={{ marginLeft: "0.5rem", color: "var(--pf-v5-global--Color--200)" }} />
                    </Tooltip>
                </CardTitle>
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
                <DragDropSort
                    items={draggableItems}
                    onDrop={(_, newItems) => handleReorder(newItems)}
                />
            </CardBody>
        </Card>
    );
};

// Disable AP Confirmation Dialog
const DisableAPConfirmDialog = ({ ssid, onConfirm, onCancel }) => {
    return (
        <Modal
            id="disable-ap-confirm-dialog"
            isOpen
            position="top"
            variant="medium"
            onClose={onCancel}
        >
            <ModalHeader title={_("Disable Access Point?")} />
            <ModalBody>
                <Alert variant="warning" isInline title={_("All connected clients will be disconnected")}>
                    <p>
                        {cockpit.format(_("Disabling the access point \"$0\" will disconnect all currently connected clients."), ssid)}
                    </p>
                </Alert>
            </ModalBody>
            <ModalFooter>
                <Button variant="danger" onClick={onConfirm}>
                    {_("Disable")}
                </Button>
                <Button variant="link" onClick={onCancel}>
                    {_("Cancel")}
                </Button>
            </ModalFooter>
        </Modal>
    );
};

// WiFi AP Client List Component
const WiFiAPClientList = ({ iface }) => {
    const [clients, setClients] = useState([]);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!iface) return;

        const leasePath = `/var/lib/NetworkManager/dnsmasq-${iface}.leases`;
        const file = cockpit.file(leasePath, { superuser: "require" });

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
                    const mac = parts[1] || "";
                    const hostname = parts[3] || mac || _("Unknown");
                    return {
                        timestamp: parts[0],
                        mac,
                        ip: parts[2] || "",
                        hostname,
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
export const WiFiAPConfig = ({ dev, connection, activeConnection }) => {
    const model = useContext(ModelContext);
    const Dialogs = useDialogs();
    const [error, setError] = useState(null);

    const settings = connection?.Settings;
    const ssid = settings?.wifi?.ssid || _("Unknown");
    const security = settings?.wifi_security?.key_mgmt ? "WPA2" : _("Open");
    const ipConfig = settings?.ipv4?.address_data?.[0] || { address: "10.42.0.1", prefix: 24 };

    // Get the actual AP interface from connection settings (interface-name), or fall back to dev
    const apInterface = settings?.connection?.interface_name || dev?.Interface;

    // Disable Access Point (with confirmation)
    const handleDisable = async () => {
        // Use the passed activeConnection, or fall back to dev.ActiveConnection for single-mode
        const apActiveConnection = activeConnection || dev?.ActiveConnection;
        if (!apActiveConnection) {
            setError(_("Cannot disable: Access Point is not active"));
            return;
        }

        const doDisable = async () => {
            try {
                await model.client.call(
                    "/org/freedesktop/NetworkManager",
                    "org.freedesktop.NetworkManager",
                    "DeactivateConnection",
                    [apActiveConnection[" priv"].path]
                );
                Dialogs.close();
            } catch (err) {
                console.error("Failed to disable AP:", err);
                setError(_("Failed to disable Access Point: ") + err.message);
                Dialogs.close();
            }
        };

        Dialogs.show(
            <DisableAPConfirmDialog
                ssid={ssid}
                onConfirm={doDisable}
                onCancel={() => Dialogs.close()}
            />
        );
    };

    // Configure Access Point
    const handleConfigure = () => {
        if (!connection) return;
        Dialogs.show(<WiFiAPDialog settings={connection.Settings} connection={connection} dev={dev} />);
    };

    return (
        <Card>
            <CardHeader actions={{
                actions: (
                    <>
                        <Button variant="secondary" onClick={handleConfigure} style={{ marginRight: "var(--pf-global--spacer--sm)" }}>
                            {_("Configure")}
                        </Button>
                        <Button variant="danger" onClick={handleDisable}>
                            {_("Disable")}
                        </Button>
                    </>
                )
            }}>
                <CardTitle>{_("Access Point")}</CardTitle>
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
                            <WiFiAPClientList iface={apInterface} />
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                </DescriptionList>
            </CardBody>
        </Card>
    );
};

// Helper function to calculate WiFi channel from frequency
function getChannelFromFrequency(freq) {
    if (freq >= 2412 && freq <= 2484) {
        // 2.4 GHz band
        if (freq === 2484) return 14;
        return Math.floor((freq - 2412) / 5) + 1;
    } else if (freq >= 5170 && freq <= 5825) {
        // 5 GHz band
        return Math.floor((freq - 5000) / 5);
    }
    return null;
}

// WiFi Connection Details Component (shows comprehensive info when connected in client mode)
const WiFiConnectionDetails = ({ dev, model }) => {
    const [connectionInfo, setConnectionInfo] = useState(null);
    const [error, setError] = useState(null);

    // Fetch connection details
    useEffect(() => {
        const fetchConnectionDetails = async () => {
            if (!dev || !dev.ActiveConnection) {
                setConnectionInfo(null);
                return;
            }

            const devPath = dev[" priv"]?.path;
            if (!devPath) return;

            try {
                // Get ActiveAccessPoint path
                const apPathResult = await model.client.call(
                    devPath,
                    "org.freedesktop.DBus.Properties",
                    "Get",
                    ["org.freedesktop.NetworkManager.Device.Wireless", "ActiveAccessPoint"]
                );
                const apPath = apPathResult[0].v;

                if (!apPath || apPath === "/") {
                    setConnectionInfo(null);
                    return;
                }

                // Get AccessPoint properties
                const apProps = await model.client.call(
                    apPath,
                    "org.freedesktop.DBus.Properties",
                    "GetAll",
                    ["org.freedesktop.NetworkManager.AccessPoint"]
                );

                // Get IP4Config properties if available
                const activeConn = dev.ActiveConnection;
                let ip4Data = null;
                if (activeConn?.Ip4Config?.[" priv"]?.path) {
                    try {
                        const ip4Props = await model.client.call(
                            activeConn.Ip4Config[" priv"].path,
                            "org.freedesktop.DBus.Properties",
                            "GetAll",
                            ["org.freedesktop.NetworkManager.IP4Config"]
                        );
                        ip4Data = ip4Props[0];
                    } catch (e) {
                        console.warn("Failed to get IP4Config:", e);
                    }
                }

                // Get bitrate
                let bitrate = 0;
                try {
                    const bitrateResult = await model.client.call(
                        devPath,
                        "org.freedesktop.DBus.Properties",
                        "Get",
                        ["org.freedesktop.NetworkManager.Device.Wireless", "Bitrate"]
                    );
                    bitrate = bitrateResult[0].v;
                } catch (e) {
                    console.warn("Failed to get Bitrate:", e);
                }

                const propsObj = apProps[0];
                const ssid = decode_nm_property(propsObj.Ssid.v);
                const bssid = propsObj.HwAddress?.v || "";
                const strength = propsObj.Strength.v;
                const frequency = propsObj.Frequency.v;
                const security = parseSecurityFlags(
                    propsObj.Flags.v,
                    propsObj.WpaFlags.v,
                    propsObj.RsnFlags.v
                );

                // Parse IP info
                let ipv4 = "";
                let gateway = "";
                let dns = [];
                if (ip4Data) {
                    if (ip4Data.AddressData?.v?.length > 0) {
                        const addr = ip4Data.AddressData.v[0];
                        ipv4 = `${addr.address.v}/${addr.prefix.v}`;
                    }
                    gateway = ip4Data.Gateway?.v || "";
                    // DNS servers are typically uint32 arrays, need to convert
                    if (ip4Data.NameserverData?.v) {
                        dns = ip4Data.NameserverData.v.map(ns => ns.address?.v || "").filter(Boolean);
                    }
                }

                setConnectionInfo({
                    ssid,
                    bssid,
                    strength,
                    frequency,
                    security,
                    bitrate,
                    ipv4,
                    gateway,
                    dns,
                    mac: dev.HwAddress,
                });
                setError(null);
            } catch (err) {
                console.error("Failed to fetch connection details:", err);
                setError(_("Failed to fetch connection details"));
            }
        };

        fetchConnectionDetails();

        // Set up periodic refresh for signal strength (5 seconds)
        const intervalId = setInterval(fetchConnectionDetails, 5000);
        return () => clearInterval(intervalId);
    }, [dev, dev?.ActiveConnection, model.client]);

    // Handle disconnect
    const handleDisconnect = useCallback(async () => {
        if (!dev?.ActiveConnection) return;

        try {
            setError(null);
            await dev.ActiveConnection.deactivate();
        } catch (err) {
            console.error("Failed to disconnect:", err);
            setError(_("Failed to disconnect: ") + err.message);
        }
    }, [dev]);

    if (!connectionInfo) return null;

    const band = connectionInfo.frequency < 3000 ? "2.4 GHz" : "5 GHz";
    const channel = getChannelFromFrequency(connectionInfo.frequency);

    return (
        <Card style={{ marginBottom: "1rem" }}>
            <CardHeader actions={{
                actions: (
                    <Button variant="warning" onClick={handleDisconnect}>
                        {_("Disconnect")}
                    </Button>
                )
            }}>
                <CardTitle>{_("Connection Details")}</CardTitle>
            </CardHeader>
            <CardBody>
                {error && (
                    <Alert variant="danger" isInline title={error} style={{ marginBottom: "1rem" }} />
                )}
                <DescriptionList isHorizontal>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Status")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            <Label color="green">{_("Connected")}</Label>
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Network")}</DescriptionListTerm>
                        <DescriptionListDescription>{connectionInfo.ssid}</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Signal")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            <SignalStrength strength={connectionInfo.strength} />
                            {" "}{connectionInfo.strength}%
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Security")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            <SecurityBadge security={connectionInfo.security} />
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("BSSID")}</DescriptionListTerm>
                        <DescriptionListDescription>{connectionInfo.bssid}</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Frequency")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            {band}{channel ? ` (${_("Channel")} ${channel})` : ""}
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Link Speed")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            {connectionInfo.bitrate ? `${connectionInfo.bitrate / 1000} Mbit/s` : _("Unknown")}
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                    {connectionInfo.ipv4 && (
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("IPv4 Address")}</DescriptionListTerm>
                            <DescriptionListDescription>{connectionInfo.ipv4}</DescriptionListDescription>
                        </DescriptionListGroup>
                    )}
                    {connectionInfo.gateway && (
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("Gateway")}</DescriptionListTerm>
                            <DescriptionListDescription>{connectionInfo.gateway}</DescriptionListDescription>
                        </DescriptionListGroup>
                    )}
                    {connectionInfo.dns.length > 0 && (
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("DNS")}</DescriptionListTerm>
                            <DescriptionListDescription>{connectionInfo.dns.join(", ")}</DescriptionListDescription>
                        </DescriptionListGroup>
                    )}
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("MAC Address")}</DescriptionListTerm>
                        <DescriptionListDescription>{connectionInfo.mac}</DescriptionListDescription>
                    </DescriptionListGroup>
                </DescriptionList>
            </CardBody>
        </Card>
    );
};

// NetworkManager WirelessCapabilities flags
const NM_WIFI_DEVICE_CAP = {
    NONE: 0x0,
    CIPHER_WEP40: 0x1,
    CIPHER_WEP104: 0x2,
    CIPHER_TKIP: 0x4,
    CIPHER_CCMP: 0x8,
    WPA: 0x10,
    RSN: 0x20,
    AP: 0x40,
    ADHOC: 0x80,
    FREQ_VALID: 0x100,
    FREQ_2GHZ: 0x200,
    FREQ_5GHZ: 0x400,
};

// Helper function to parse WiFi device capabilities
function parseWiFiCapabilities(capFlags) {
    return {
        supportsAP: (capFlags & NM_WIFI_DEVICE_CAP.AP) !== 0,
        supportsAdHoc: (capFlags & NM_WIFI_DEVICE_CAP.ADHOC) !== 0,
        supports2GHz: (capFlags & NM_WIFI_DEVICE_CAP.FREQ_2GHZ) !== 0,
        supports5GHz: (capFlags & NM_WIFI_DEVICE_CAP.FREQ_5GHZ) !== 0,
        supportsWPA: (capFlags & NM_WIFI_DEVICE_CAP.WPA) !== 0,
        supportsRSN: (capFlags & NM_WIFI_DEVICE_CAP.RSN) !== 0,
        raw: capFlags,
    };
}

// Detect current WiFi connection states
// Returns object with both client and AP states (for dual mode support)
function getWiFiConnectionStates(dev, model) {
    const result = {
        clientActive: false,
        apActive: false,
        clientConnection: null,
        apConnection: null,
    };

    if (!dev) return result;

    // Check the device's direct ActiveConnection first (works for single mode)
    const activeConn = dev.ActiveConnection;
    if (activeConn) {
        const connection = activeConn.Connection;
        const settings = connection?.Settings;
        if (settings && settings.connection?.type === "802-11-wireless") {
            const mode = settings.wifi?.mode;
            if (mode === "ap") {
                result.apActive = true;
                result.apConnection = activeConn;
            } else if (mode === "infrastructure" || !mode) {
                result.clientActive = true;
                result.clientConnection = activeConn;
            }
        }
    }

    // For dual mode, also check all active connections from the manager
    // This handles the case where we have separate interfaces (wlan0 + ap0)
    if (model) {
        const manager = model.get_manager();
        if (manager?.ActiveConnections) {
            for (const ac of manager.ActiveConnections) {
                const connection = ac.Connection;
                const settings = connection?.Settings;
                if (!settings || settings.connection?.type !== "802-11-wireless") continue;

                // Check if this is a WiFi connection we care about
                const mode = settings.wifi?.mode;
                if (mode === "ap" && !result.apActive) {
                    result.apActive = true;
                    result.apConnection = ac;
                } else if ((mode === "infrastructure" || !mode) && !result.clientActive) {
                    result.clientActive = true;
                    result.clientConnection = ac;
                }
            }
        }
    }

    return result;
}

// WiFi Page Component (for future use with dedicated WiFi management page)
export const WiFiPage = ({ iface, dev }) => {
    const model = useContext(ModelContext);
    const Dialogs = useDialogs();
    const [scanning, setScanning] = useState(false);
    const [accessPoints, setAccessPoints] = useState([]);
    const [error, setError] = useState(null);
    // Dual-mode state: track both client and AP connections independently
    const [connectionStates, setConnectionStates] = useState({
        clientActive: false,
        apActive: false,
        clientConnection: null,
        apConnection: null,
    });
    // Hardware capabilities
    const [capabilities, setCapabilities] = useState(null);
    const [capabilitiesError, setCapabilitiesError] = useState(null);
    const fetchRequestIdRef = useRef(0); // Track fetch requests to handle race conditions
    // Device availability state (for rfkill handling)
    const [deviceUnavailable, setDeviceUnavailable] = useState(false);
    const [rfkillBlocked, setRfkillBlocked] = useState(false);
    const [enablingWifi, setEnablingWifi] = useState(false);

    // Fetch device capabilities on mount
    useEffect(() => {
        const fetchCapabilities = async () => {
            const devPath = dev?.[" priv"]?.path;
            if (!devPath || !model?.client) return;

            try {
                const capsResult = await model.client.call(
                    devPath,
                    "org.freedesktop.DBus.Properties",
                    "Get",
                    ["org.freedesktop.NetworkManager.Device.Wireless", "WirelessCapabilities"]
                );
                const capsFlags = capsResult[0].v;
                setCapabilities(parseWiFiCapabilities(capsFlags));
                setCapabilitiesError(null);
            } catch (err) {
                console.error("Failed to fetch WiFi capabilities:", err);
                setCapabilitiesError(_("Failed to detect WiFi capabilities"));
                // Set default capabilities (assume basic support)
                setCapabilities({
                    supportsAP: false,
                    supportsAdHoc: false,
                    supports2GHz: true,
                    supports5GHz: false,
                    supportsWPA: true,
                    supportsRSN: true,
                    raw: 0,
                });
            }
        };

        fetchCapabilities();
    }, [dev, model?.client]);

    // Check device availability and rfkill status
    useEffect(() => {
        const checkDeviceAvailability = async () => {
            if (!dev) {
                setDeviceUnavailable(false);
                setRfkillBlocked(false);
                return;
            }

            const isUnavailable = dev.State === NM_DEVICE_STATE_UNAVAILABLE;
            setDeviceUnavailable(isUnavailable);

            if (isUnavailable) {
                // Check rfkill status for wlan
                try {
                    const result = await cockpit.spawn(
                        ["rfkill", "list", "wlan"],
                        { err: "ignore" }
                    );
                    // Check if soft blocked (output contains "Soft blocked: yes")
                    const softBlocked = result.includes("Soft blocked: yes");
                    setRfkillBlocked(softBlocked);
                } catch (err) {
                    console.warn("Failed to check rfkill status:", err);
                    setRfkillBlocked(false);
                }
            } else {
                setRfkillBlocked(false);
            }
        };

        checkDeviceAvailability();

        // Re-check when model changes (device state may have changed)
        if (model) {
            model.addEventListener("changed", checkDeviceAvailability);
            return () => model.removeEventListener("changed", checkDeviceAvailability);
        }
    }, [dev, model]);

    // Enable WiFi (unblock rfkill)
    const handleEnableWifi = useCallback(async () => {
        setEnablingWifi(true);
        setError(null);

        try {
            // Use rfkill command to unblock wlan
            await cockpit.spawn(
                ["rfkill", "unblock", "wlan"],
                { superuser: "require", err: "message" }
            );
            // Wait a moment for NetworkManager to notice the change
            await new Promise(resolve => setTimeout(resolve, 2000));
            // The model change event should update our state
        } catch (err) {
            console.error("Failed to enable WiFi:", err);
            setError(_("Failed to enable WiFi: ") + (err.message || String(err)));
        } finally {
            setEnablingWifi(false);
        }
    }, []);

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

    // Get current channel from client connection
    const getClientChannel = useCallback(async () => {
        const mainIface = dev.Interface;
        try {
            // Get current frequency from iw (use full path)
            const result = await cockpit.spawn(
                ["/usr/sbin/iw", "dev", mainIface, "info"],
                { err: "ignore" }
            );
            // Parse frequency from output like "channel 6 (2437 MHz)"
            const channelMatch = result.match(/channel\s+(\d+)/);
            if (channelMatch) {
                return parseInt(channelMatch[1], 10);
            }
        } catch (err) {
            console.error("Failed to get client channel:", err);
        }
        return 0; // Auto channel if we can't detect
    }, [dev]);

    // Enable Access Point
    const handleEnableAP = useCallback(async () => {
        const { clientActive } = connectionStates;

        let targetInterface = dev.Interface;
        let recommendedChannel = 0;

        // If client is already connected, we need dual-mode setup
        if (clientActive) {
            setError(null);

            // Get the current channel from the client connection
            recommendedChannel = await getClientChannel();

            // Use <iface>ap naming for the virtual AP interface (e.g., wlan0ap)
            // This clearly indicates the relationship to the parent interface
            targetInterface = dev.Interface + "ap";
        }

        // Create settings with the appropriate interface and channel
        const settings = getWiFiAPGhostSettings({ newIfaceName: targetInterface, dev });

        // If we have a recommended channel (same as client), set it
        if (recommendedChannel > 0) {
            settings.wifi = settings.wifi || {};
            settings.wifi.channel = recommendedChannel;
            // Set band based on channel
            settings.wifi.band = recommendedChannel > 14 ? "a" : "bg";
        }

        Dialogs.show(<WiFiAPDialog settings={settings} dev={dev} dualMode={clientActive} />);
    }, [dev, Dialogs, connectionStates, getClientChannel]);

    // Connect to hidden network
    const handleConnectHidden = useCallback(() => {
        Dialogs.show(<WiFiHiddenDialog dev={dev} />);
    }, [dev, Dialogs]);

    // Detect current WiFi connection states (supports dual mode)
    // Subscribe to model changes to properly detect when connections on other interfaces activate
    useEffect(() => {
        const updateConnectionStates = () => {
            const states = getWiFiConnectionStates(dev, model);
            setConnectionStates(states);
            // Clear any errors when connection state changes
            setError(null);
        };

        // Initial update
        updateConnectionStates();

        // Subscribe to model changes (important for dual-mode detection)
        if (model) {
            model.addEventListener("changed", updateConnectionStates);
            return () => {
                model.removeEventListener("changed", updateConnectionStates);
            };
        }
    }, [dev, model]);

    // Auto-scan on mount (scan unless in AP-only mode)
    useEffect(() => {
        // Only skip scanning if ONLY AP is active (no client mode)
        const isAPOnly = connectionStates.apActive && !connectionStates.clientActive;
        if (!isAPOnly && dev && dev[" priv"]?.path) {
            handleScan();
        }
    }, [dev, handleScan, connectionStates.apActive, connectionStates.clientActive]);

    // Poll for access points every 15 seconds (unless in AP-only mode)
    useEffect(() => {
        const isAPOnly = connectionStates.apActive && !connectionStates.clientActive;
        if (isAPOnly || !dev || !dev[" priv"]?.path) return;

        const intervalId = setInterval(() => {
            if (!scanning) {
                handleScan();
            }
        }, 15000);

        return () => clearInterval(intervalId);
    }, [connectionStates.apActive, connectionStates.clientActive, dev, scanning, handleScan]);

    // Dual mode rendering: show both AP and client sections as needed
    const { clientActive, apActive, apConnection } = connectionStates;
    const isDualMode = clientActive && apActive;

    // Determine if AP button should be disabled (no AP support)
    const canEnableAP = capabilities?.supportsAP !== false;

    // Action links for WiFi unavailable alert (only show enable button if rfkill blocked)
    const wifiUnavailableActionLinks = rfkillBlocked
        ? (
            <Button
                variant="link"
                isInline
                onClick={handleEnableWifi}
                isLoading={enablingWifi}
                isDisabled={enablingWifi}
            >
                {enablingWifi ? _("Enabling...") : _("Enable WiFi")}
            </Button>
        )
        : undefined;

    return (
        <>
            {/* WiFi disabled/unavailable warning */}
            {deviceUnavailable && (
                <Alert
                    variant="warning"
                    isInline
                    title={rfkillBlocked ? _("WiFi is disabled") : _("WiFi adapter unavailable")}
                    style={{ marginBottom: "1rem" }}
                    actionLinks={wifiUnavailableActionLinks}
                >
                    {rfkillBlocked
                        ? _("WiFi has been disabled via software. Click 'Enable WiFi' to turn it back on. If this doesn't work, the WLAN regulatory domain (country) may need to be configured via system settings.")
                        : _("The WiFi adapter is not available. This may be due to missing WLAN country/regulatory configuration, a hardware issue, or missing drivers. Check system settings to configure the WLAN country.")}
                </Alert>
            )}

            {/* Dual mode indicator */}
            {isDualMode && (
                <Alert
                    variant="info"
                    isInline
                    title={_("Dual Mode Active")}
                    style={{ marginBottom: "1rem" }}
                >
                    {_("Both Access Point and Client modes are running simultaneously.")}
                </Alert>
            )}

            {/* Show AP status card when AP is active */}
            {apActive && (
                <div style={{ marginBottom: "1rem" }}>
                    <WiFiAPConfig
                        dev={dev}
                        connection={apConnection?.Connection}
                        activeConnection={apConnection}
                    />
                </div>
            )}

            {/* Show client connection details when connected as client */}
            {clientActive && (
                <WiFiConnectionDetails dev={dev} model={model} />
            )}

            {/* Show client mode UI (network list and controls) */}
            <Card>
                <CardHeader>
                    <CardTitle>{_("WiFi Networks")}</CardTitle>
                    <Flex style={{ gap: "1rem" }}>
                        <FlexItem>
                            <Button onClick={handleScan} isDisabled={scanning || deviceUnavailable} style={{ minWidth: "7rem" }}>
                                {scanning ? _("Scanning...") : _("Scan")}
                            </Button>
                        </FlexItem>
                        <FlexItem>
                            <Button variant="secondary" onClick={handleConnectHidden} isDisabled={deviceUnavailable}>
                                {_("Connect to Hidden Network")}
                            </Button>
                        </FlexItem>
                        {!apActive && (
                            <FlexItem>
                                <Button
                                    variant="secondary"
                                    onClick={handleEnableAP}
                                    isDisabled={!canEnableAP || deviceUnavailable}
                                    title={!canEnableAP ? _("This device does not support Access Point mode") : undefined}
                                >
                                    {_("Enable Access Point")}
                                </Button>
                            </FlexItem>
                        )}
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
                    {capabilitiesError && (
                        <Alert
                            variant="warning"
                            isInline
                            title={capabilitiesError}
                            style={{ marginBottom: "1rem" }}
                        />
                    )}
                    {!canEnableAP && !apActive && (
                        <Alert
                            variant="info"
                            isInline
                            title={_("Access Point mode not supported")}
                            style={{ marginBottom: "1rem" }}
                        >
                            {_("This WiFi adapter does not support Access Point mode.")}
                        </Alert>
                    )}
                    <WiFiNetworkList
                        accessPoints={accessPoints}
                        onConnect={handleConnect}
                        scanning={scanning}
                    />
                </CardBody>
            </Card>
            <WiFiSavedNetworks dev={dev} model={model} />
        </>
    );
};
