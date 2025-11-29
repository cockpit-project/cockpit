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
import { EmptyState, EmptyStateBody } from '@patternfly/react-core/dist/esm/components/EmptyState/index.js';
import { Form, FormGroup, FormHelperText } from '@patternfly/react-core/dist/esm/components/Form/index.js';
import { HelperText, HelperTextItem } from '@patternfly/react-core/dist/esm/components/HelperText/index.js';
import { List, ListItem } from '@patternfly/react-core/dist/esm/components/List/index.js';
import { Spinner } from '@patternfly/react-core/dist/esm/components/Spinner/index.js';
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

// Ghost settings for "Add WiFi" action
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

// WiFi Page Component (for future use with dedicated WiFi management page)
export const WiFiPage = ({ iface, dev }) => {
    const model = useContext(ModelContext);
    const Dialogs = useDialogs();
    const [scanning, setScanning] = useState(false);
    const [accessPoints, setAccessPoints] = useState([]);
    const [error, setError] = useState(null);
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

    // Auto-scan on mount
    useEffect(() => {
        if (dev && dev[" priv"]?.path) {
            fetchAccessPoints();
        }
    }, [dev, fetchAccessPoints]);

    return (
        <Card>
            <CardHeader>
                <CardTitle>{_("WiFi Networks")}</CardTitle>
                <Button onClick={handleScan} isDisabled={scanning}>
                    {scanning ? _("Scanning...") : _("Scan")}
                </Button>
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
