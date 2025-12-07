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
 * WiFi Hooks - State management hooks for WiFi network configuration
 *
 * This module provides React hooks for accessing WiFi-related state from
 * the NetworkManager model. These hooks decouple WiFi logic from UI components,
 * making the code more maintainable and testable.
 *
 * @module wifi-hooks
 */

import { useCallback, useContext, useEffect, useRef, useState } from 'react';

import { ModelContext } from './model-context';
import { decode_nm_property } from './utils';

/**
 * Parse security flags from AccessPoint properties
 * @param {number} flags - AP flags
 * @param {number} wpaFlags - WPA security flags
 * @param {number} rsnFlags - RSN (WPA2/WPA3) security flags
 * @returns {'open' | 'wpa' | 'wpa2' | 'wpa3'} Security type
 */
export function parseSecurityFlags(flags, wpaFlags, rsnFlags) {
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

/**
 * Hook to get a list of WiFi (802.11 wireless) devices from the model.
 *
 * @returns {{
 *   devices: Array<Object>,
 *   loading: boolean,
 *   error: string | null
 * }} Object containing WiFi devices, loading state, and any error
 *
 * @example
 * const { devices, loading, error } = useWiFiDevices();
 * if (loading) return <Spinner />;
 * if (error) return <Alert variant="danger">{error}</Alert>;
 * return devices.map(dev => <WiFiCard key={dev.Interface} device={dev} />);
 */
export function useWiFiDevices() {
    const model = useContext(ModelContext);
    const [devices, setDevices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!model) {
            setLoading(false);
            setError("NetworkManager model not available");
            return;
        }

        const updateDevices = () => {
            try {
                const manager = model.get_manager();
                if (!manager || !manager.Devices) {
                    setDevices([]);
                    setLoading(!model.ready);
                    return;
                }

                // Filter for WiFi devices (DeviceType === '802-11-wireless')
                const wifiDevices = manager.Devices.filter(
                    dev => dev.DeviceType === '802-11-wireless'
                );

                setDevices(wifiDevices);
                setLoading(false);
                setError(null);
            } catch (err) {
                console.error("Error fetching WiFi devices:", err);
                setError("Failed to fetch WiFi devices");
                setLoading(false);
            }
        };

        // Initial update
        updateDevices();

        // Subscribe to model changes
        model.addEventListener("changed", updateDevices);
        return () => {
            model.removeEventListener("changed", updateDevices);
        };
    }, [model]);

    return { devices, loading, error };
}

/**
 * Hook to handle WiFi network scanning.
 *
 * Provides functionality to trigger scans, fetch access points, and track
 * scan state. Uses polling on LastScan property to detect scan completion.
 *
 * @param {Object | null} device - The WiFi device to scan on
 * @returns {{
 *   accessPoints: Array<Object>,
 *   scanning: boolean,
 *   lastScan: number,
 *   error: string | null,
 *   scan: () => Promise<void>,
 *   refresh: () => Promise<void>
 * }} Object containing access points, scan state, and control functions
 *
 * @example
 * const { accessPoints, scanning, scan, error } = useWiFiScan(device);
 * return (
 *   <>
 *     <Button onClick={scan} disabled={scanning}>Scan</Button>
 *     {accessPoints.map(ap => <NetworkItem key={ap.path} ap={ap} />)}
 *   </>
 * );
 */
export function useWiFiScan(device) {
    const model = useContext(ModelContext);
    const [accessPoints, setAccessPoints] = useState([]);
    const [scanning, setScanning] = useState(false);
    const [lastScan, setLastScan] = useState(0);
    const [error, setError] = useState(null);
    const fetchRequestIdRef = useRef(0);

    /**
     * Fetch access points from the device
     */
    const fetchAccessPoints = useCallback(async () => {
        if (!device || !model?.client) {
            return;
        }

        const devPath = device[" priv"]?.path;
        if (!devPath) {
            return;
        }

        // Increment request ID to track this fetch
        const requestId = ++fetchRequestIdRef.current;

        try {
            // Get AccessPoints property
            const apPathsResult = await model.client.call(
                devPath,
                "org.freedesktop.DBus.Properties",
                "Get",
                ["org.freedesktop.NetworkManager.Device.Wireless", "AccessPoints"]
            );

            // Check if this request is still valid
            if (requestId !== fetchRequestIdRef.current) {
                return; // Ignore stale response
            }

            const apPaths = apPathsResult[0].v;

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
            if (requestId === fetchRequestIdRef.current) {
                console.error("Failed to fetch access points:", err);
                setError("Failed to retrieve WiFi networks");
            }
        }
    }, [device, model?.client]);

    /**
     * Wait for scan completion by polling LastScan property
     */
    const waitForScanCompletion = useCallback(async (devPath, initialLastScan) => {
        if (!model?.client) return false;

        const maxAttempts = 20; // 20 * 500ms = 10 seconds max
        const pollInterval = 500;

        for (let i = 0; i < maxAttempts; i++) {
            await new Promise(resolve => setTimeout(resolve, pollInterval));

            try {
                const lastScanResult = await model.client.call(
                    devPath,
                    "org.freedesktop.DBus.Properties",
                    "Get",
                    ["org.freedesktop.NetworkManager.Device.Wireless", "LastScan"]
                );

                const newLastScan = lastScanResult[0].v;

                if (newLastScan !== initialLastScan) {
                    setLastScan(newLastScan);
                    return true;
                }
            } catch (err) {
                console.error("Error polling LastScan:", err);
            }
        }

        return false; // Timeout reached
    }, [model?.client]);

    /**
     * Trigger a network scan
     */
    const scan = useCallback(async () => {
        if (!device || !model?.client) {
            setError("Device or model not available");
            return;
        }

        setScanning(true);
        setError(null);

        try {
            const devPath = device[" priv"]?.path;
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

            // Request an active scan
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
            setError("WiFi scan failed");
            // Still try to fetch APs even if scan failed
            await fetchAccessPoints();
        } finally {
            setScanning(false);
        }
    }, [device, model?.client, waitForScanCompletion, fetchAccessPoints]);

    /**
     * Refresh access points without triggering a new scan
     */
    const refresh = useCallback(async () => {
        await fetchAccessPoints();
    }, [fetchAccessPoints]);

    // Auto-fetch access points when device changes
    useEffect(() => {
        if (device) {
            fetchAccessPoints();
        } else {
            setAccessPoints([]);
        }
    }, [device, fetchAccessPoints]);

    return {
        accessPoints,
        scanning,
        lastScan,
        error,
        scan,
        refresh,
    };
}

/**
 * Hook to retrieve saved WiFi connections (network profiles).
 *
 * Filters NetworkManager connections to return only WiFi client mode
 * connections (excludes AP mode connections).
 *
 * @returns {{
 *   savedNetworks: Array<Object>,
 *   loading: boolean,
 *   error: string | null,
 *   forgetNetwork: (connection: Object) => Promise<void>,
 *   connectToSaved: (connection: Object, device: Object) => Promise<void>
 * }} Object containing saved networks and control functions
 *
 * @example
 * const { savedNetworks, forgetNetwork } = useWiFiSavedNetworks();
 * return savedNetworks.map(con => (
 *   <NetworkItem
 *     key={con[" priv"].path}
 *     ssid={con.Settings.wifi?.ssid}
 *     onForget={() => forgetNetwork(con)}
 *   />
 * ));
 */
export function useWiFiSavedNetworks() {
    const model = useContext(ModelContext);
    const [savedNetworks, setSavedNetworks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!model) {
            setLoading(false);
            setError("NetworkManager model not available");
            return;
        }

        const updateSavedNetworks = () => {
            try {
                const manager = model.get_manager();
                if (!manager || !manager.Connections) {
                    // Try get_settings instead
                    const settings = model.get_settings?.();
                    if (!settings || !settings.Connections) {
                        setSavedNetworks([]);
                        setLoading(!model.ready);
                        return;
                    }
                }

                const settings = model.get_settings();
                if (!settings || !settings.Connections) {
                    setSavedNetworks([]);
                    setLoading(!model.ready);
                    return;
                }

                // Filter for WiFi connections that are not AP mode
                const wifiConnections = settings.Connections.filter(con => {
                    const conSettings = con.Settings;
                    if (!conSettings || conSettings.connection?.type !== "802-11-wireless") {
                        return false;
                    }
                    // Exclude AP mode connections
                    const mode = conSettings.wifi?.mode || conSettings["802-11-wireless"]?.mode?.v;
                    return mode !== "ap";
                });

                setSavedNetworks(wifiConnections);
                setLoading(false);
                setError(null);
            } catch (err) {
                console.error("Error fetching saved networks:", err);
                setError("Failed to fetch saved networks");
                setLoading(false);
            }
        };

        // Initial update
        updateSavedNetworks();

        // Subscribe to model changes
        model.addEventListener("changed", updateSavedNetworks);
        return () => {
            model.removeEventListener("changed", updateSavedNetworks);
        };
    }, [model]);

    /**
     * Forget (delete) a saved network
     */
    const forgetNetwork = useCallback(async (connection) => {
        if (!connection) return;

        try {
            await connection.delete_();
        } catch (err) {
            console.error("Failed to forget network:", err);
            throw err;
        }
    }, []);

    /**
     * Connect to a saved network
     */
    const connectToSaved = useCallback(async (connection, device) => {
        if (!connection || !device) return;

        try {
            await connection.activate(device, null);
        } catch (err) {
            console.error("Failed to connect to saved network:", err);
            throw err;
        }
    }, []);

    return {
        savedNetworks,
        loading,
        error,
        forgetNetwork,
        connectToSaved,
    };
}

/**
 * Connection state enum values
 * @readonly
 * @enum {string}
 */
export const ConnectionState = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    DEACTIVATING: 'deactivating',
    FAILED: 'failed',
};

/**
 * Map NetworkManager device states to connection states
 * @param {number} nmState - NetworkManager device state
 * @returns {string} Connection state
 */
function mapNMStateToConnectionState(nmState) {
    switch (nmState) {
    case 0: // NM_DEVICE_STATE_UNKNOWN
    case 10: // NM_DEVICE_STATE_UNMANAGED
    case 20: // NM_DEVICE_STATE_UNAVAILABLE
    case 30: // NM_DEVICE_STATE_DISCONNECTED
        return ConnectionState.DISCONNECTED;
    case 40: // NM_DEVICE_STATE_PREPARE
    case 50: // NM_DEVICE_STATE_CONFIG
    case 60: // NM_DEVICE_STATE_NEED_AUTH
    case 70: // NM_DEVICE_STATE_IP_CONFIG
    case 80: // NM_DEVICE_STATE_IP_CHECK
    case 90: // NM_DEVICE_STATE_SECONDARIES
        return ConnectionState.CONNECTING;
    case 100: // NM_DEVICE_STATE_ACTIVATED
        return ConnectionState.CONNECTED;
    case 110: // NM_DEVICE_STATE_DEACTIVATING
        return ConnectionState.DEACTIVATING;
    case 120: // NM_DEVICE_STATE_FAILED
        return ConnectionState.FAILED;
    default:
        return ConnectionState.DISCONNECTED;
    }
}

/**
 * Hook to track the current WiFi connection state for a device.
 *
 * Exposes the connection state (connected, connecting, disconnected, etc.),
 * active connection object, and active access point information. Also
 * supports dual-mode detection (simultaneous AP + client).
 *
 * @param {Object | null} device - The WiFi device to track
 * @returns {{
 *   state: string,
 *   activeConnection: Object | null,
 *   activeAccessPoint: Object | null,
 *   clientActive: boolean,
 *   apActive: boolean,
 *   isDualMode: boolean,
 *   clientConnection: Object | null,
 *   apConnection: Object | null,
 *   ssid: string | null,
 *   disconnect: () => Promise<void>
 * }} Object containing connection state and control functions
 *
 * @example
 * const { state, ssid, disconnect } = useWiFiConnectionState(device);
 * return (
 *   <>
 *     <StatusBadge state={state} />
 *     {state === 'connected' && <Text>Connected to {ssid}</Text>}
 *     {state === 'connected' && <Button onClick={disconnect}>Disconnect</Button>}
 *   </>
 * );
 */
export function useWiFiConnectionState(device) {
    const model = useContext(ModelContext);
    const [state, setState] = useState(ConnectionState.DISCONNECTED);
    const [activeConnection, setActiveConnection] = useState(null);
    const [activeAccessPoint, setActiveAccessPoint] = useState(null);
    const [ssid, setSsid] = useState(null);

    // Dual-mode state
    const [clientActive, setClientActive] = useState(false);
    const [apActive, setApActive] = useState(false);
    const [clientConnection, setClientConnection] = useState(null);
    const [apConnection, setApConnection] = useState(null);

    useEffect(() => {
        if (!model || !device) {
            setState(ConnectionState.DISCONNECTED);
            setActiveConnection(null);
            setActiveAccessPoint(null);
            setSsid(null);
            setClientActive(false);
            setApActive(false);
            setClientConnection(null);
            setApConnection(null);
            return;
        }

        const updateConnectionState = () => {
            // Map device state to connection state
            const deviceState = device.State;
            const connectionState = mapNMStateToConnectionState(deviceState);
            setState(connectionState);

            // Get active connection from device
            const activeCon = device.ActiveConnection;
            setActiveConnection(activeCon);

            // Detect client and AP states
            let isClientActive = false;
            let isApActive = false;
            let clientCon = null;
            let apCon = null;

            // Check the device's direct ActiveConnection
            if (activeCon) {
                const connection = activeCon.Connection;
                const settings = connection?.Settings;
                if (settings && settings.connection?.type === "802-11-wireless") {
                    const mode = settings.wifi?.mode;
                    if (mode === "ap") {
                        isApActive = true;
                        apCon = activeCon;
                    } else if (mode === "infrastructure" || !mode) {
                        isClientActive = true;
                        clientCon = activeCon;
                    }
                }
            }

            // For dual mode, also check all active connections from the manager
            const manager = model.get_manager();
            if (manager?.ActiveConnections) {
                for (const ac of manager.ActiveConnections) {
                    const connection = ac.Connection;
                    const settings = connection?.Settings;
                    if (!settings || settings.connection?.type !== "802-11-wireless") continue;

                    const mode = settings.wifi?.mode;
                    if (mode === "ap" && !isApActive) {
                        isApActive = true;
                        apCon = ac;
                    } else if ((mode === "infrastructure" || !mode) && !isClientActive) {
                        isClientActive = true;
                        clientCon = ac;
                    }
                }
            }

            setClientActive(isClientActive);
            setApActive(isApActive);
            setClientConnection(clientCon);
            setApConnection(apCon);

            // Get SSID from active connection settings
            if (clientCon?.Connection?.Settings?.wifi?.ssid) {
                setSsid(clientCon.Connection.Settings.wifi.ssid);
            } else if (activeCon?.Connection?.Settings?.wifi?.ssid) {
                setSsid(activeCon.Connection.Settings.wifi.ssid);
            } else {
                setSsid(null);
            }

            // Update active access point asynchronously
            if (connectionState === ConnectionState.CONNECTED && device[" priv"]?.path && model.client) {
                model.client.call(
                    device[" priv"].path,
                    "org.freedesktop.DBus.Properties",
                    "Get",
                    ["org.freedesktop.NetworkManager.Device.Wireless", "ActiveAccessPoint"]
                ).then(result => {
                    const apPath = result[0].v;
                    if (apPath && apPath !== "/") {
                        setActiveAccessPoint({ path: apPath });
                    } else {
                        setActiveAccessPoint(null);
                    }
                }).catch(() => {
                    setActiveAccessPoint(null);
                });
            } else {
                setActiveAccessPoint(null);
            }
        };

        // Initial update
        updateConnectionState();

        // Subscribe to model changes
        model.addEventListener("changed", updateConnectionState);
        return () => {
            model.removeEventListener("changed", updateConnectionState);
        };
    }, [model, device]);

    /**
     * Disconnect from the current network
     */
    const disconnect = useCallback(async () => {
        if (!activeConnection) {
            throw new Error("No active connection to disconnect");
        }

        try {
            await activeConnection.deactivate();
        } catch (err) {
            console.error("Failed to disconnect:", err);
            throw err;
        }
    }, [activeConnection]);

    return {
        state,
        activeConnection,
        activeAccessPoint,
        clientActive,
        apActive,
        isDualMode: clientActive && apActive,
        clientConnection,
        apConnection,
        ssid,
        disconnect,
    };
}

/**
 * Hook to get WiFi device capabilities.
 *
 * @param {Object | null} device - The WiFi device to check
 * @returns {{
 *   capabilities: Object | null,
 *   loading: boolean,
 *   error: string | null
 * }} Object containing capabilities
 */
export function useWiFiCapabilities(device) {
    const model = useContext(ModelContext);
    const [capabilities, setCapabilities] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!device || !model?.client) {
            setCapabilities(null);
            setLoading(false);
            return;
        }

        const fetchCapabilities = async () => {
            const devPath = device[" priv"]?.path;
            if (!devPath) {
                setLoading(false);
                return;
            }

            try {
                const capsResult = await model.client.call(
                    devPath,
                    "org.freedesktop.DBus.Properties",
                    "Get",
                    ["org.freedesktop.NetworkManager.Device.Wireless", "WirelessCapabilities"]
                );
                const capsFlags = capsResult[0].v;

                // Parse capability flags
                const NM_WIFI_DEVICE_CAP = {
                    AP: 0x40,
                    ADHOC: 0x80,
                    FREQ_2GHZ: 0x200,
                    FREQ_5GHZ: 0x400,
                };

                setCapabilities({
                    supportsAP: (capsFlags & NM_WIFI_DEVICE_CAP.AP) !== 0,
                    supportsAdHoc: (capsFlags & NM_WIFI_DEVICE_CAP.ADHOC) !== 0,
                    supports2GHz: (capsFlags & NM_WIFI_DEVICE_CAP.FREQ_2GHZ) !== 0,
                    supports5GHz: (capsFlags & NM_WIFI_DEVICE_CAP.FREQ_5GHZ) !== 0,
                    raw: capsFlags,
                });
                setError(null);
            } catch (err) {
                console.error("Failed to fetch WiFi capabilities:", err);
                setError("Failed to detect WiFi capabilities");
                // Set default capabilities
                setCapabilities({
                    supportsAP: false,
                    supportsAdHoc: false,
                    supports2GHz: true,
                    supports5GHz: false,
                    raw: 0,
                });
            } finally {
                setLoading(false);
            }
        };

        setLoading(true);
        fetchCapabilities();
    }, [device, model?.client]);

    return { capabilities, loading, error };
}
