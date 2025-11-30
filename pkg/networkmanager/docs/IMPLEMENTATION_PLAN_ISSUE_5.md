# Implementation Plan: WiFi Access Point Mode (Issue #5)

**Date:** 2025-11-30
**Issue:** https://github.com/hatlabs/cockpit/issues/5
**Status:** Planning Complete

## Overview

Complete the WiFi Access Point configuration feature by adding status monitoring, client listing, and enhanced configuration options.

## Current State

**Already Implemented:**
- ✅ WiFiAPDialog - Dialog for creating/editing AP connections
- ✅ getWiFiAPGhostSettings - Default AP settings generator
- ✅ WiFiPage - Basic structure with "Enable AP" button
- ✅ SSID generation (HALOS-{MAC})
- ✅ Basic validation (SSID 32 bytes, password 8-63 chars)
- ✅ Integration in NetworkAction factory

**Missing (This Implementation):**
- ❌ WiFiAPConfig - Status card showing AP state
- ❌ WiFiAPClientList - Connected clients display
- ❌ AP lifecycle monitoring and disable functionality
- ❌ Enhanced dialog options (channel, visibility, IP range)
- ❌ Mode detection and UI switching

## Components to Implement

### 1. WiFiAPConfig Component

**File:** `pkg/networkmanager/wifi.jsx` (add to existing file)

**Purpose:** Display Access Point status and provide management controls

**Props:**
```javascript
{
  dev: Device,           // WiFi device object
  connection: Connection, // Active AP connection
  onDisable: Function,    // Callback to disable AP
  onConfigure: Function   // Callback to edit AP
}
```

**UI Structure:**
```jsx
<Card>
  <CardHeader>
    <CardTitle>Access Point</CardTitle>
    <CardActions>
      <Button onClick={onConfigure}>Configure</Button>
      <Button variant="danger" onClick={onDisable}>Disable</Button>
    </CardActions>
  </CardHeader>
  <CardBody>
    <DescriptionList isHorizontal>
      <DescriptionListGroup>
        <DescriptionListTerm>Status</DescriptionListTerm>
        <DescriptionListDescription>
          <Label color="green">Active</Label>
        </DescriptionListDescription>
      </DescriptionListGroup>
      <DescriptionListGroup>
        <DescriptionListTerm>SSID</DescriptionListTerm>
        <DescriptionListDescription>{ssid}</DescriptionListDescription>
      </DescriptionListGroup>
      <DescriptionListGroup>
        <DescriptionListTerm>Security</DescriptionListTerm>
        <DescriptionListDescription>WPA2 / Open</DescriptionListDescription>
      </DescriptionListGroup>
      <DescriptionListGroup>
        <DescriptionListTerm>IP Range</DescriptionListTerm>
        <DescriptionListDescription>{address}/{prefix}</DescriptionListDescription>
      </DescriptionListGroup>
      <DescriptionListGroup>
        <DescriptionListTerm>Connected Clients</DescriptionListTerm>
        <DescriptionListDescription>{clientCount}</DescriptionListDescription>
      </DescriptionListGroup>
    </DescriptionList>

    <WiFiAPClientList iface={dev.Interface} />
  </CardBody>
</Card>
```

**Data Extraction:**
```javascript
// From connection.Settings
const ssid = connection.Settings.wifi.ssid;
const security = connection.Settings.wifi_security?.key_mgmt || "none";
const ipConfig = connection.Settings.ipv4.address_data[0];
const address = ipConfig.address;
const prefix = ipConfig.prefix;
```

### 2. WiFiAPClientList Component

**Purpose:** Display list of devices connected to the AP

**Data Source:** DHCP lease file
**Path:** `/var/lib/NetworkManager/dnsmasq-<interface>.leases`
**Format:** `<timestamp> <mac> <ip> <hostname> <client-id>`

**Implementation:**
```javascript
const WiFiAPClientList = ({ iface }) => {
    const [clients, setClients] = useState([]);
    const [error, setError] = useState(null);

    useEffect(() => {
        const leasePath = `/var/lib/NetworkManager/dnsmasq-${iface}.leases`;
        const file = cockpit.file(leasePath, { superuser: "try" });

        file.watch((content) => {
            if (!content) {
                setClients([]);
                return;
            }

            const lines = content.trim().split('\n');
            const parsed = lines.map(line => {
                const parts = line.split(' ');
                return {
                    timestamp: parts[0],
                    mac: parts[1],
                    ip: parts[2],
                    hostname: parts[3] || "Unknown",
                    clientId: parts[4] || "",
                };
            });

            setClients(parsed);
        }, { err => setError(err) });

        return () => file.close();
    }, [iface]);

    if (error) {
        return <Alert variant="warning">Unable to load client list</Alert>;
    }

    if (clients.length === 0) {
        return <EmptyState>
            <EmptyStateBody>No clients connected</EmptyStateBody>
        </EmptyState>;
    }

    return (
        <Table variant="compact">
            <Thead>
                <Tr>
                    <Th>Client</Th>
                    <Th>IP Address</Th>
                    <Th>MAC Address</Th>
                </Tr>
            </Thead>
            <Tbody>
                {clients.map(client => (
                    <Tr key={client.mac}>
                        <Td>{client.hostname}</Td>
                        <Td>{client.ip}</Td>
                        <Td>{client.mac}</Td>
                    </Tr>
                ))}
            </Tbody>
        </Table>
    );
};
```

### 3. Enhanced WiFiAPDialog

**Additions to existing dialog:**

**a) Channel Selection:**
```jsx
<FormGroup label={_("Channel")}>
    <select
        id={idPrefix + "-channel-select"}
        className="pf-v6-c-form-control"
        value={channel}
        onChange={(e) => setChannel(parseInt(e.target.value))}
    >
        <option value="0">{_("Automatic")}</option>
        {/* 2.4GHz channels */}
        {band === "bg" && [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(ch => (
            <option key={ch} value={ch}>{ch}</option>
        ))}
        {/* 5GHz channels */}
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
```

**b) SSID Visibility:**
```jsx
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
```

**c) IP Range Configuration:**
```jsx
<FormGroup label={_("IP Address")}>
    <TextInput
        id={idPrefix + "-ip-input"}
        value={ipAddress}
        onChange={(_, val) => setIPAddress(val)}
        validated={ipValidation.valid ? "default" : "error"}
    />
    {!ipValidation.valid && (
        <FormHelperText>
            <HelperText>
                <HelperTextItem variant="error">
                    {ipValidation.message}
                </HelperTextItem>
            </HelperText>
        </FormHelperText>
    )}
</FormGroup>

<FormGroup label={_("Subnet Prefix")}>
    <TextInput
        id={idPrefix + "-prefix-input"}
        type="number"
        value={prefix}
        onChange={(_, val) => setPrefix(parseInt(val))}
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
```

**Updated Settings Object:**
```javascript
const apSettings = {
    connection: { ... },
    wifi: {
        ssid,
        mode: "ap",
        band,
        channel: channel || undefined,  // 0 = omit for auto
        hidden,                          // NEW
    },
    ipv4: {
        method: "shared",
        address_data: [{
            address: ipAddress,          // Configurable
            prefix: prefix               // Configurable
        }],
    },
    ipv6: { method: "ignore" },
};
```

### 4. AP Lifecycle Management

**a) Mode Detection Helper:**
```javascript
function getWiFiMode(dev) {
    const activeConn = dev.ActiveConnection;
    if (!activeConn) return "inactive";

    const settings = activeConn.Settings;
    if (settings?.connection?.type !== "802-11-wireless") return "other";

    const mode = settings.wifi?.mode;
    if (mode === "ap") return "ap";
    if (mode === "infrastructure") return "client";
    return "unknown";
}
```

**b) Disable AP Function:**
```javascript
async function disableAP(model, activeConnectionPath) {
    try {
        await model.client.call(
            "/org/freedesktop/NetworkManager",
            "org.freedesktop.NetworkManager",
            "DeactivateConnection",
            [activeConnectionPath]
        );
    } catch (err) {
        throw new Error(_("Failed to disable Access Point: ") + err.message);
    }
}
```

**c) Reconfigure AP:**
```javascript
function handleConfigureAP(dev, connection) {
    const settings = connection.Settings;
    Dialogs.show(<WiFiAPDialog settings={settings} connection={connection} dev={dev} />);
}
```

### 5. WiFiPage Mode Switching

**Updated WiFiPage Component:**
```javascript
export const WiFiPage = ({ iface, dev }) => {
    const model = useContext(ModelContext);
    const Dialogs = useDialogs();
    const [mode, setMode] = useState("inactive");
    const [apConnection, setAPConnection] = useState(null);

    // ... existing state ...

    // Detect current mode
    useEffect(() => {
        const currentMode = getWiFiMode(dev);
        setMode(currentMode);

        if (currentMode === "ap") {
            setAPConnection(dev.ActiveConnection);
        } else {
            setAPConnection(null);
        }
    }, [dev, dev.ActiveConnection]);

    // Handle disable AP
    const handleDisableAP = useCallback(async () => {
        if (!apConnection) return;

        try {
            await disableAP(model, apConnection[" priv"].path);
        } catch (err) {
            console.error("Failed to disable AP:", err);
            // Show error to user
        }
    }, [model, apConnection]);

    // Handle configure AP
    const handleConfigureAP = useCallback(() => {
        if (!apConnection) return;
        Dialogs.show(<WiFiAPDialog settings={apConnection.Settings} connection={apConnection} dev={dev} />);
    }, [apConnection, dev, Dialogs]);

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

    // Show existing client mode UI
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
                {/* ... existing WiFi network list ... */}
            </CardBody>
        </Card>
    );
};
```

## Implementation Order

1. **WiFiAPConfig component** - Status display card
2. **Mode detection** - getWiFiMode helper + state management
3. **WiFiPage switching** - Conditional rendering based on mode
4. **Disable AP** - DeactivateConnection integration
5. **WiFiAPClientList** - DHCP lease file reading
6. **Enhanced WiFiAPDialog** - Channel, visibility, IP range fields
7. **Validation** - IP address, channel validation
8. **Testing** - Manual verification of all features
9. **Documentation** - Update acceptance criteria

## Testing Plan

### Manual Test Cases

1. **Enable AP - Defaults**
   - Enable AP with default settings
   - Verify SSID is HALOS-{MAC}
   - Verify 2.4GHz band
   - Verify WPA2 security
   - Verify IP 10.42.0.1/24

2. **Enable AP - Custom Settings**
   - Set custom SSID
   - Set specific channel
   - Enable hidden SSID
   - Set custom IP range
   - Verify all settings applied

3. **Client Connection**
   - Connect device to AP
   - Verify gets DHCP IP in correct range
   - Verify appears in client list
   - Verify hostname/MAC/IP shown

4. **Disable AP**
   - Disable active AP
   - Verify stops broadcasting
   - Verify UI returns to client mode
   - Verify no errors

5. **Reconfigure AP**
   - Edit active AP settings
   - Verify changes applied
   - Verify AP restarts with new settings

6. **Mode Switching**
   - Switch from AP to client mode
   - Switch from client to AP mode
   - Verify no conflicts
   - Verify UI updates correctly

### Acceptance Criteria (Issue #5)

- [ ] Can enable AP with default settings
- [ ] Can customize AP configuration (SSID, password, security, band, channel, visibility, IP)
- [ ] AP broadcasts and accepts connections
- [ ] DHCP server works for AP clients
- [ ] Connected clients shown in list
- [ ] Can disable AP
- [ ] Can reconfigure active AP
- [ ] Security requirements met (no password leaks)
- [ ] Follows WIFI_ARCHITECTURE.md AP flow
- [ ] Matches WIFI_SPEC.md workflow 3
- [ ] Tests written and passing
- [ ] Video demonstration created

## Security Considerations

- Never display existing WiFi passwords
- Clear passwords from state after connection
- Use superuser mode only when necessary for lease file
- Validate all user input (SSID, password, IP, channel)
- Warn about open/hidden networks

## Success Criteria

✅ WiFiAPConfig shows when AP active
✅ Client list populated from DHCP leases
✅ All dialog options functional
✅ AP can be enabled, disabled, reconfigured
✅ Mode switching smooth and conflict-free
✅ All manual tests pass
✅ No regressions in existing functionality
✅ Code follows Cockpit patterns
✅ Documentation updated

## Notes

- DHCP lease file may not exist if no clients connected - handle gracefully
- Channel validation depends on band selection
- IP validation should check for valid private ranges
- Hidden SSID requires clients to manually enter network name
- Mode switching may briefly interrupt connectivity

## References

- WIFI_ARCHITECTURE.md - AP mode data flow
- WIFI_SPEC.md - Workflow 3 (Configuring WiFi Access Point)
- wireguard.jsx - Reference pattern for component structure
- dialogs-common.jsx - NetworkModal and dialogSave patterns
