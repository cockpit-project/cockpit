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
 * WiFi UI Components - Phase 2 Implementation
 *
 * This module provides reusable UI components for WiFi network management.
 * Components consume hooks from wifi-hooks.js for state management.
 *
 * @module wifi-components
 */

import cockpit from 'cockpit';
import React, { useCallback, useMemo, useState } from 'react';

import { Alert } from '@patternfly/react-core/dist/esm/components/Alert/index.js';
import { Badge } from '@patternfly/react-core/dist/esm/components/Badge/index.js';
import { Button } from '@patternfly/react-core/dist/esm/components/Button/index.js';
import { Card, CardBody, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from '@patternfly/react-core/dist/esm/components/DescriptionList/index.js';
import { EmptyState, EmptyStateBody } from '@patternfly/react-core/dist/esm/components/EmptyState/index.js';
import { Label } from '@patternfly/react-core/dist/esm/components/Label/index.js';
import { List, ListItem } from '@patternfly/react-core/dist/esm/components/List/index.js';
import { Spinner } from '@patternfly/react-core/dist/esm/components/Spinner/index.js';
import { Switch } from '@patternfly/react-core/dist/esm/components/Switch/index.js';
import { Tooltip } from '@patternfly/react-core/dist/esm/components/Tooltip/index.js';
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { LockIcon, WifiIcon, OutlinedQuestionCircleIcon, AngleUpIcon, AngleDownIcon } from '@patternfly/react-icons';

import {
    useWiFiScan,
    useWiFiSavedNetworks,
    useWiFiConnectionState,
    useWiFiCapabilities,
    ConnectionState,
} from './wifi-hooks';

const _ = cockpit.gettext;

// ============================================================================
// Helper Components
// ============================================================================

/**
 * Convert signal strength percentage to bar count (0-4)
 * @param {number} strength - Signal strength 0-100
 * @returns {number} Number of bars 0-4
 */
export function strengthToBars(strength) {
    if (strength <= 0) return 0;
    if (strength <= 25) return 1;
    if (strength <= 50) return 2;
    if (strength <= 75) return 3;
    return 4;
}

/**
 * Get descriptive text for signal strength
 * @param {number} strength - Signal strength 0-100
 * @returns {string} Description (Excellent, Good, Fair, Weak, No signal)
 */
export function strengthToText(strength) {
    if (strength <= 0) return _("No signal");
    if (strength <= 25) return _("Weak");
    if (strength <= 50) return _("Fair");
    if (strength <= 75) return _("Good");
    return _("Excellent");
}

/**
 * Extract SSID from NetworkManager connection settings
 *
 * Handles multiple NetworkManager property formats:
 * - wifi.ssid: Legacy/simplified format used by some cockpit code
 * - 802-11-wireless.ssid: Standard NM format, may be wrapped in variant object
 * - connection.id: Fallback to connection name
 *
 * @param {Object} settings - Connection settings object from NetworkManager
 * @returns {string} The SSID or localized "Unknown" if not found
 */
export function extractSSID(settings) {
    // Try wifi.ssid first (legacy/simplified format)
    if (settings?.wifi?.ssid) return settings.wifi.ssid;

    // Try 802-11-wireless.ssid (standard NM format)
    const wirelessSSID = settings?.["802-11-wireless"]?.ssid;
    if (wirelessSSID?.v) return wirelessSSID.v; // Variant-wrapped
    if (wirelessSSID) return wirelessSSID;

    // Fallback to connection ID (usually matches SSID for WiFi)
    return settings?.connection?.id || _("Unknown");
}

/**
 * Signal Strength Icon Component
 *
 * Displays WiFi signal strength as visual bars with accessible label.
 *
 * @param {Object} props
 * @param {number} props.strength - Signal strength 0-100
 * @param {boolean} [props.showLabel] - Show text label
 */
export const SignalStrengthIcon = ({ strength, showLabel = false }) => {
    const bars = strengthToBars(strength);
    const label = strengthToText(strength);

    // SVG-based signal bars for crisp rendering
    // 4 bars with increasing heights: 25%, 50%, 75%, 100%
    const barHeights = [6, 10, 14, 18];
    const barWidth = 3;
    const barGap = 2;
    const svgWidth = (barWidth + barGap) * 4;
    const svgHeight = 20;

    return (
        <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
            <FlexItem>
                <svg
                    width={svgWidth}
                    height={svgHeight}
                    viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                    aria-label={cockpit.format(_("Signal strength: $0"), label)}
                    role="img"
                    aria-hidden={showLabel ? "true" : undefined}
                >
                    {barHeights.map((height, idx) => (
                        <rect
                            key={idx}
                            x={idx * (barWidth + barGap)}
                            y={svgHeight - height}
                            width={barWidth}
                            height={height}
                            rx={1}
                            fill={idx < bars ? "var(--pf-v6-global--success-color--100)" : "var(--pf-v6-global--disabled-color--200)"}
                        />
                    ))}
                </svg>
            </FlexItem>
            {showLabel && (
                <FlexItem>
                    <span className="pf-v6-u-font-size-sm">{strength}%</span>
                </FlexItem>
            )}
        </Flex>
    );
};

/**
 * Security Badge Component
 *
 * Displays security type with appropriate color coding.
 *
 * @param {Object} props
 * @param {'open' | 'wpa' | 'wpa2' | 'wpa3'} props.security - Security type
 */
export const SecurityBadge = ({ security }) => {
    const config = {
        open: { label: _("Open"), color: "grey", icon: false },
        wpa: { label: _("WPA"), color: "blue", icon: true },
        wpa2: { label: _("WPA2"), color: "blue", icon: true },
        wpa3: { label: _("WPA3"), color: "green", icon: true },
    };

    const { label, color, icon } = config[security] || config.wpa2;

    return (
        <Label color={color} icon={icon ? <LockIcon /> : null}>
            {label}
        </Label>
    );
};

/**
 * Connection Status Label
 *
 * Shows current connection state with appropriate styling.
 *
 * @param {Object} props
 * @param {string} props.state - Connection state from ConnectionState enum
 * @param {string} [props.ssid] - Connected network SSID
 */
export const ConnectionStatusLabel = ({ state, ssid }) => {
    const config = {
        [ConnectionState.CONNECTED]: { label: ssid ? cockpit.format(_("Connected to $0"), ssid) : _("Connected"), color: "green" },
        [ConnectionState.CONNECTING]: { label: _("Connecting..."), color: "blue" },
        [ConnectionState.DISCONNECTED]: { label: _("Disconnected"), color: "grey" },
        [ConnectionState.DEACTIVATING]: { label: _("Disconnecting..."), color: "orange" },
        [ConnectionState.FAILED]: { label: _("Connection failed"), color: "red" },
    };

    const { label, color } = config[state] || config[ConnectionState.DISCONNECTED];

    return <Label color={color}>{label}</Label>;
};

// ============================================================================
// WiFi Scan List Component
// ============================================================================

/**
 * WiFi Network List Item Component
 *
 * Individual network item in the scan results list showing SSID, signal strength,
 * and security type. Clickable to initiate connection.
 *
 * @param {Object} props
 * @param {Object} props.ap - Access point data (ssid, strength, security, path)
 * @param {boolean} props.isActive - Whether this is the currently connected network
 * @param {Function} props.onConnect - Callback when network is clicked for connection
 */
const WiFiNetworkListItem = ({ ap, isActive, onConnect }) => {
    return (
        <ListItem
            onClick={() => onConnect(ap)}
            className="wifi-network-item"
            style={{ cursor: 'pointer', padding: 'var(--pf-v6-global--spacer--sm)' }}
            aria-label={cockpit.format(_("Connect to $0"), ap.ssid)}
        >
            <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
                <FlexItem flex={{ default: 'flex_1' }}>
                    <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
                        <FlexItem>
                            <WifiIcon />
                        </FlexItem>
                        <FlexItem>
                            <span className="wifi-ssid">{ap.ssid}</span>
                        </FlexItem>
                        {isActive && (
                            <FlexItem>
                                <Badge isRead>{_("Connected")}</Badge>
                            </FlexItem>
                        )}
                    </Flex>
                </FlexItem>
                <FlexItem>
                    <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsMd' }}>
                        <FlexItem>
                            <SignalStrengthIcon strength={ap.strength} />
                        </FlexItem>
                        <FlexItem>
                            <SecurityBadge security={ap.security} />
                        </FlexItem>
                    </Flex>
                </FlexItem>
            </Flex>
        </ListItem>
    );
};

/**
 * WiFi Scan List Component
 *
 * Displays a scrollable list of available WiFi networks sorted by signal strength.
 * Uses useWiFiScan hook for state management.
 *
 * @param {Object} props
 * @param {Object} props.device - WiFi device object
 * @param {string} [props.activeSSID] - Currently connected SSID
 * @param {Function} props.onConnect - Callback when network is clicked
 * @param {number} [props.maxHeight] - Maximum height for scrollable list
 */
export const WiFiScanList = ({ device, activeSSID, onConnect, maxHeight = 300 }) => {
    const { accessPoints, scanning, error, scan } = useWiFiScan(device);

    // Filter out empty SSIDs and deduplicate by SSID, keeping strongest signal
    const processedNetworks = useMemo(() => {
        const uniqueNetworks = new Map();

        accessPoints
                .filter(ap => ap.ssid && ap.ssid.trim() !== "")
                .forEach(ap => {
                    const existing = uniqueNetworks.get(ap.ssid);
                    if (!existing || ap.strength > existing.strength) {
                        uniqueNetworks.set(ap.ssid, ap);
                    }
                });

        // Sort by signal strength descending
        return Array.from(uniqueNetworks.values())
                .sort((a, b) => b.strength - a.strength);
    }, [accessPoints]);

    if (error) {
        return (
            <Alert variant="danger" isInline title={_("Scan Error")}>
                {error}
            </Alert>
        );
    }

    if (scanning && processedNetworks.length === 0) {
        return (
            <EmptyState>
                <Spinner size="lg" aria-label={_("Scanning for networks")} />
                <EmptyStateBody>{_("Scanning for networks...")}</EmptyStateBody>
            </EmptyState>
        );
    }

    if (processedNetworks.length === 0) {
        return (
            <EmptyState>
                <WifiIcon size="lg" />
                <EmptyStateBody>
                    {_("No networks found")}
                </EmptyStateBody>
                <Button variant="primary" onClick={scan} isDisabled={scanning}>
                    {_("Scan Again")}
                </Button>
            </EmptyState>
        );
    }

    return (
        <div style={{ maxHeight, overflowY: 'auto' }}>
            <List isPlain aria-label={_("Available WiFi networks")}>
                {processedNetworks.map((ap, idx) => (
                    <WiFiNetworkListItem
                        key={ap.path || `${ap.ssid}-${idx}`}
                        ap={ap}
                        isActive={ap.ssid === activeSSID}
                        onConnect={onConnect}
                    />
                ))}
            </List>
        </div>
    );
};

// ============================================================================
// WiFi Saved Networks List Component
// ============================================================================

/**
 * WiFi Saved Network Item Component
 *
 * Individual saved network entry with priority controls, auto-connect toggle,
 * connect button, and forget action.
 *
 * @param {Object} props
 * @param {Object} props.connection - NetworkManager connection object with Settings
 * @param {boolean} props.isActive - Whether this is the currently connected network
 * @param {Function} props.onConnect - Callback to connect to this network
 * @param {Function} props.onForget - Callback to forget/delete this network
 * @param {Function} props.onToggleAutoConnect - Callback to toggle auto-connect setting
 * @param {number} props.index - Position in the list (for priority controls)
 * @param {number} props.total - Total number of saved networks
 * @param {Function} props.onMoveUp - Callback to increase priority (move up in list)
 * @param {Function} props.onMoveDown - Callback to decrease priority (move down in list)
 */
const WiFiSavedNetworkItem = ({
    connection,
    isActive,
    onConnect,
    onForget,
    onToggleAutoConnect,
    index,
    total,
    onMoveUp,
    onMoveDown,
}) => {
    const settings = connection.Settings;
    const ssid = extractSSID(settings);
    const autoConnect = settings?.connection?.autoconnect !== false;

    return (
        <ListItem className="wifi-saved-network-item">
            <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
                <FlexItem flex={{ default: 'flex_1' }}>
                    <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
                        <FlexItem>
                            <WifiIcon />
                        </FlexItem>
                        <FlexItem>
                            <span className="wifi-ssid">{ssid}</span>
                        </FlexItem>
                        {isActive && (
                            <FlexItem>
                                <Label color="green">{_("Connected")}</Label>
                            </FlexItem>
                        )}
                    </Flex>
                </FlexItem>
                <FlexItem>
                    <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
                        {/* Priority controls */}
                        <FlexItem>
                            <Tooltip content={_("Move up (higher priority)")}>
                                <Button
                                    variant="plain"
                                    aria-label={_("Move up")}
                                    isDisabled={index === 0}
                                    onClick={() => onMoveUp(connection)}
                                    size="sm"
                                    icon={<AngleUpIcon />}
                                />
                            </Tooltip>
                        </FlexItem>
                        <FlexItem>
                            <Tooltip content={_("Move down (lower priority)")}>
                                <Button
                                    variant="plain"
                                    aria-label={_("Move down")}
                                    isDisabled={index === total - 1}
                                    onClick={() => onMoveDown(connection)}
                                    size="sm"
                                    icon={<AngleDownIcon />}
                                />
                            </Tooltip>
                        </FlexItem>
                        {/* Auto-connect toggle */}
                        <FlexItem>
                            <Tooltip content={autoConnect ? _("Auto-connect enabled") : _("Auto-connect disabled")}>
                                <Switch
                                    id={`autoconnect-${connection[" priv"]?.path}`}
                                    aria-label={_("Auto-connect")}
                                    isChecked={autoConnect}
                                    onChange={() => onToggleAutoConnect(connection, !autoConnect)}
                                    isReversed
                                />
                            </Tooltip>
                        </FlexItem>
                        {/* Connect button (when not active) */}
                        {!isActive && (
                            <FlexItem>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => onConnect(connection)}
                                >
                                    {_("Connect")}
                                </Button>
                            </FlexItem>
                        )}
                        {/* Forget button */}
                        <FlexItem>
                            <Button
                                variant="link"
                                isDanger
                                size="sm"
                                onClick={() => onForget(connection)}
                            >
                                {_("Forget")}
                            </Button>
                        </FlexItem>
                    </Flex>
                </FlexItem>
            </Flex>
        </ListItem>
    );
};

/**
 * WiFi Saved Networks List Component
 *
 * Displays saved WiFi networks with priority reordering, auto-connect toggle,
 * and forget functionality. Uses useWiFiSavedNetworks hook.
 *
 * @param {Object} props
 * @param {Object} props.device - WiFi device object
 * @param {string} [props.activeConnectionPath] - Path of active connection
 */
export const WiFiSavedList = ({ device, activeConnectionPath }) => {
    const { savedNetworks, loading, error, forgetNetwork, connectToSaved } = useWiFiSavedNetworks();
    const [actionError, setActionError] = useState(null);

    const handleConnect = useCallback(async (connection) => {
        try {
            setActionError(null);
            await connectToSaved(connection, device);
        } catch (err) {
            setActionError(cockpit.format(_("Failed to connect: $0"), err.message));
        }
    }, [connectToSaved, device]);

    const handleForget = useCallback(async (connection) => {
        try {
            setActionError(null);
            await forgetNetwork(connection);
        } catch (err) {
            setActionError(cockpit.format(_("Failed to forget network: $0"), err.message));
        }
    }, [forgetNetwork]);

    const handleToggleAutoConnect = useCallback(async (connection, autoConnect) => {
        try {
            setActionError(null);
            // Update connection settings
            const newSettings = {
                ...connection.Settings,
                connection: {
                    ...connection.Settings.connection,
                    autoconnect: autoConnect,
                },
            };
            await connection.update(newSettings);
        } catch (err) {
            setActionError(cockpit.format(_("Failed to update auto-connect: $0"), err.message));
        }
    }, []);

    // Priority reordering (changes autoconnect-priority setting)
    const handleMoveUp = useCallback(async (connection) => {
        // TODO: Implement priority adjustment via NM connection settings
        console.log("Move up:", connection);
    }, []);

    const handleMoveDown = useCallback(async (connection) => {
        // TODO: Implement priority adjustment via NM connection settings
        console.log("Move down:", connection);
    }, []);

    if (loading) {
        return (
            <Card>
                <CardBody>
                    <Spinner size="lg" aria-label={_("Loading saved networks")} />
                </CardBody>
            </Card>
        );
    }

    if (error) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>{_("Saved Networks")}</CardTitle>
                </CardHeader>
                <CardBody>
                    <Alert variant="danger" isInline title={error} />
                </CardBody>
            </Card>
        );
    }

    if (savedNetworks.length === 0) {
        return null; // Don't show card if no saved networks
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
                        <FlexItem>{_("Saved Networks")}</FlexItem>
                        <FlexItem>
                            <Tooltip content={_("Networks are connected in priority order. Use arrows to change priority.")}>
                                <OutlinedQuestionCircleIcon />
                            </Tooltip>
                        </FlexItem>
                    </Flex>
                </CardTitle>
            </CardHeader>
            <CardBody>
                {actionError && (
                    <Alert
                        variant="danger"
                        isInline
                        title={actionError}
                        actionClose={<Button variant="plain" onClick={() => setActionError(null)}>×</Button>}
                        style={{ marginBottom: 'var(--pf-v6-global--spacer--md)' }}
                    />
                )}
                <List isPlain aria-label={_("Saved WiFi networks")}>
                    {savedNetworks.map((connection, idx) => (
                        <WiFiSavedNetworkItem
                            key={connection[" priv"]?.path || idx}
                            connection={connection}
                            isActive={connection[" priv"]?.path === activeConnectionPath}
                            onConnect={handleConnect}
                            onForget={handleForget}
                            onToggleAutoConnect={handleToggleAutoConnect}
                            onMoveUp={handleMoveUp}
                            onMoveDown={handleMoveDown}
                            index={idx}
                            total={savedNetworks.length}
                        />
                    ))}
                </List>
            </CardBody>
        </Card>
    );
};

// ============================================================================
// WiFi Overview Card Component
// ============================================================================

/**
 * WiFi Overview Card Component
 *
 * Main card showing WiFi device status, current connection, and controls.
 * Uses hooks from wifi-hooks.js for all state management.
 *
 * @param {Object} props
 * @param {Object} props.device - WiFi device object
 * @param {Function} props.onScan - Callback to trigger network scan
 * @param {Function} props.onConnect - Callback when connecting to a network
 * @param {Function} props.onDisconnect - Callback to disconnect
 * @param {Function} [props.onEnableAP] - Callback to enable Access Point mode
 * @param {Function} [props.onConnectHidden] - Callback to connect to hidden network
 * @param {React.ReactNode} [props.children] - Child components (e.g., WiFiScanList)
 */
export const WiFiOverview = ({
    device,
    onScan,
    onConnect,
    onDisconnect,
    onEnableAP,
    onConnectHidden,
    children,
}) => {
    const { state, ssid, apActive, isDualMode, disconnect } = useWiFiConnectionState(device);
    const { capabilities } = useWiFiCapabilities(device);
    const { scanning, scan } = useWiFiScan(device);

    const handleScan = useCallback(() => {
        scan();
        if (onScan) onScan();
    }, [scan, onScan]);

    const handleDisconnect = useCallback(async () => {
        try {
            await disconnect();
            if (onDisconnect) onDisconnect();
        } catch (err) {
            console.error("Failed to disconnect:", err);
        }
    }, [disconnect, onDisconnect]);

    const canEnableAP = capabilities?.supportsAP !== false;

    return (
        <Card>
            <CardHeader
                actions={{
                    actions: (
                        <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                            <FlexItem>
                                <Button
                                    variant="secondary"
                                    onClick={handleScan}
                                    isDisabled={scanning}
                                    isLoading={scanning}
                                >
                                    {scanning ? _("Scanning...") : _("Scan")}
                                </Button>
                            </FlexItem>
                            {onConnectHidden && (
                                <FlexItem>
                                    <Button variant="secondary" onClick={onConnectHidden}>
                                        {_("Hidden Network")}
                                    </Button>
                                </FlexItem>
                            )}
                            {onEnableAP && !apActive && (
                                <FlexItem>
                                    <Tooltip
                                        content={!canEnableAP ? _("This device does not support Access Point mode") : _("Enable Access Point")}
                                    >
                                        <Button
                                            variant="secondary"
                                            onClick={onEnableAP}
                                            isDisabled={!canEnableAP}
                                        >
                                            {_("Enable AP")}
                                        </Button>
                                    </Tooltip>
                                </FlexItem>
                            )}
                        </Flex>
                    )
                }}
            >
                <CardTitle>
                    <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsMd' }}>
                        <FlexItem>
                            <WifiIcon size="md" />
                        </FlexItem>
                        <FlexItem>
                            {device?.Interface || _("WiFi")}
                        </FlexItem>
                        <FlexItem>
                            <ConnectionStatusLabel state={state} ssid={ssid} />
                        </FlexItem>
                        {isDualMode && (
                            <FlexItem>
                                <Label color="purple">{_("Dual Mode")}</Label>
                            </FlexItem>
                        )}
                    </Flex>
                </CardTitle>
            </CardHeader>
            <CardBody>
                {/* Connection details when connected */}
                {state === ConnectionState.CONNECTED && (
                    <DescriptionList isHorizontal isCompact style={{ marginBottom: 'var(--pf-v6-global--spacer--md)' }}>
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("Network")}</DescriptionListTerm>
                            <DescriptionListDescription>{ssid}</DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("MAC Address")}</DescriptionListTerm>
                            <DescriptionListDescription>{device?.HwAddress}</DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                            <DescriptionListTerm />
                            <DescriptionListDescription>
                                <Button variant="warning" size="sm" onClick={handleDisconnect}>
                                    {_("Disconnect")}
                                </Button>
                            </DescriptionListDescription>
                        </DescriptionListGroup>
                    </DescriptionList>
                )}

                {/* Dual mode indicator */}
                {isDualMode && (
                    <Alert
                        variant="info"
                        isInline
                        title={_("Running in dual mode")}
                        style={{ marginBottom: 'var(--pf-v6-global--spacer--md)' }}
                    >
                        {_("Both Access Point and Client connections are active.")}
                    </Alert>
                )}

                {/* Child content (e.g., WiFiScanList) */}
                {children}
            </CardBody>
        </Card>
    );
};

// ============================================================================
// Exports
// ============================================================================

export {
    ConnectionState,
};
