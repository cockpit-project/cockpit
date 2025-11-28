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

import React, { useContext, useState, useEffect } from 'react';
import cockpit from 'cockpit';

import { Badge } from '@patternfly/react-core/dist/esm/components/Badge/index.js';
import { Button } from '@patternfly/react-core/dist/esm/components/Button/index.js';
import { Card, CardBody, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { EmptyState, EmptyStateBody } from '@patternfly/react-core/dist/esm/components/EmptyState/index.js';
import { Form, FormGroup } from '@patternfly/react-core/dist/esm/components/Form/index.js';
import { List, ListItem } from '@patternfly/react-core/dist/esm/components/List/index.js';
import { Spinner } from '@patternfly/react-core/dist/esm/components/Spinner/index.js';
import { TextInput } from '@patternfly/react-core/dist/esm/components/TextInput/index.js';
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { WifiIcon } from '@patternfly/react-icons';

import { Name, NetworkModal, dialogSave } from "./dialogs-common";
import { ModelContext } from './model-context';
import { useDialogs } from 'dialogs.jsx';
import { v4 as uuidv4 } from 'uuid';

const _ = cockpit.gettext;

// Helper functions for SSID byte array conversion
function bytesToString(bytes) {
    if (!bytes || bytes.length === 0) return "";
    return String.fromCharCode(...bytes);
}

function stringToBytes(str) {
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
        bytes.push(str.charCodeAt(i));
    }
    return bytes;
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

    // Sort by signal strength (strongest first)
    const sorted = [...accessPoints].sort((a, b) => b.strength - a.strength);

    return (
        <List>
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

    const [ssid, setSSID] = useState(ap ? bytesToString(ap.ssid) : (settings.wifi?.ssid || ""));
    const [password, setPassword] = useState("");
    const [dialogError, setDialogError] = useState("");

    const isCreateDialog = !connection;

    const onSubmit = (ev) => {
        if (ev) {
            ev.preventDefault();
        }

        // Build WiFi connection settings
        const wifiSettings = {
            ...settings,
            connection: {
                ...settings.connection,
                id: ssid,
                type: "802-11-wireless",
                uuid: settings.connection.uuid || uuidv4(),
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
                    iface={dev}
                    settings={settings}
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
                        />
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

// WiFi Page Component (for future use with dedicated WiFi management page)
export const WiFiPage = ({ iface, dev }) => {
    const model = useContext(ModelContext);
    const Dialogs = useDialogs();
    const [scanning, setScanning] = useState(false);
    const [accessPoints, setAccessPoints] = useState([]);

    // Fetch access points from device
    const fetchAccessPoints = async () => {
        if (!dev || !dev._path) return;

        try {
            const apPaths = await model.client.call(
                dev._path,
                "org.freedesktop.NetworkManager.Device.Wireless",
                "GetAccessPoints",
                []
            );

            const aps = await Promise.all(
                apPaths[0].map(async (apPath) => {
                    const props = await model.client.call(
                        apPath,
                        "org.freedesktop.DBus.Properties",
                        "GetAll",
                        ["org.freedesktop.NetworkManager.AccessPoint"]
                    );

                    const propsObj = props[0];
                    return {
                        path: apPath,
                        ssid: bytesToString(propsObj.Ssid.v),
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

            setAccessPoints(aps);
        } catch (error) {
            console.error("Failed to fetch access points:", error);
        }
    };

    // Trigger network scan
    const handleScan = async () => {
        setScanning(true);
        try {
            await model.client.call(
                dev._path,
                "org.freedesktop.NetworkManager.Device.Wireless",
                "RequestScan",
                [{}]
            );

            // Wait for scan to complete
            await new Promise(resolve => setTimeout(resolve, 5000));

            await fetchAccessPoints();
        } catch (error) {
            console.error("Scan failed:", error);
        } finally {
            setScanning(false);
        }
    };

    // Connect to network
    const handleConnect = (ap) => {
        if (ap.security === "open") {
            // TODO: Show warning dialog for open networks
            console.warn("Connecting to open network:", ap.ssid);
        }

        const settings = getWiFiGhostSettings({ newIfaceName: dev.Interface });
        Dialogs.show(<WiFiConnectDialog settings={settings} dev={dev} ap={ap} />);
    };

    // Auto-scan on mount
    useEffect(() => {
        if (dev && dev._path) {
            fetchAccessPoints();
        }
    }, [dev]);

    return (
        <Card>
            <CardHeader>
                <CardTitle>{_("WiFi Networks")}</CardTitle>
                <Button onClick={handleScan} isDisabled={scanning}>
                    {scanning ? _("Scanning...") : _("Scan")}
                </Button>
            </CardHeader>
            <CardBody>
                <WiFiNetworkList
                    accessPoints={accessPoints}
                    onConnect={handleConnect}
                    scanning={scanning}
                />
            </CardBody>
        </Card>
    );
};
