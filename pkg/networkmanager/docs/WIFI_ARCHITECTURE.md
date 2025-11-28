# WiFi Network Configuration - System Architecture

**Version**: 1.0
**Last Modified**: 2025-11-28
**Status**: Draft

## Overview

This document defines the technical architecture for WiFi configuration support in Cockpit's NetworkManager module. The design follows established Cockpit patterns, particularly the WireGuard implementation, while addressing WiFi-specific requirements.

## Design Principles

1. **Follow Cockpit Patterns**: Reuse established architectural approaches from existing network type implementations
2. **NetworkManager Native**: All operations via NetworkManager D-Bus API
3. **Zero Backend Code**: Leverage Cockpit's existing D-Bus bridge, no custom backend services
4. **Progressive Enhancement**: Degrade gracefully if WiFi hardware unavailable
5. **Upstream Compatible**: Design for potential contribution to Cockpit project

## System Context

```
┌─────────────────────────────────────────────────────────┐
│                    User's Browser                        │
│                  (React + PatternFly)                   │
└────────────┬────────────────────────────────────────────┘
             │ HTTPS (WebSocket for D-Bus)
             │
┌────────────▼────────────────────────────────────────────┐
│                   Cockpit Bridge                         │
│              (cockpit-ws + cockpit-bridge)               │
└────────────┬────────────────────────────────────────────┘
             │ D-Bus
             │
┌────────────▼────────────────────────────────────────────┐
│                  NetworkManager                          │
│              (org.freedesktop.NetworkManager)            │
└────────────┬────────────────────────────────────────────┘
             │
    ┌────────┴────────┬───────────────┐
    │                 │               │
┌───▼───┐      ┌──────▼──────┐  ┌────▼────┐
│wpa_   │      │  hostapd    │  │ kernel  │
│suppl. │      │             │  │ drivers │
└───┬───┘      └──────┬──────┘  └────┬────┘
    │                 │              │
    └─────────────────┴──────────────┘
             WiFi Hardware
```

## Component Architecture

### File Structure

Following Cockpit's modular organization:

```
pkg/networkmanager/
├── wifi.jsx                    # Main WiFi UI components (NEW)
├── wifi-dialogs.jsx           # WiFi-specific dialogs (NEW)
├── network-main.jsx            # Modified: Add WiFi tab/section
├── network-interface.jsx       # Modified: WiFi device details
├── dialogs-common.jsx         # Modified: Add WiFi to NetworkAction
├── interfaces.js               # Modified: WiFi device type handling
├── manifest.json               # Module metadata
└── docs/
    ├── WIFI_SPEC.md
    └── WIFI_ARCHITECTURE.md
```

### New Components

#### `wifi.jsx` - Main WiFi Component

Primary WiFi management interface, structured similarly to wireguard.jsx:

**Exports:**
- `WiFiPage`: Main page component
- `WiFiClientConfig`: Client mode configuration
- `WiFiAPConfig`: Access Point configuration
- `WiFiNetworkList`: Scannable network list
- `WiFiConnectionDialog`: Connect to network dialog

**State Management:**
- Device list (WiFi interfaces)
- Scanned networks (Access Points)
- Active connections
- Connection state (connecting, connected, disconnected)
- Scan state (scanning, idle, error)

#### `wifi-dialogs.jsx` - WiFi Dialogs

Reusable dialog components:

**Dialogs:**
- `WiFiConnectDialog`: Connect to WPA/WPA2/WPA3 network
- `WiFiAPDialog`: Configure Access Point
- `WiFiForgetDialog`: Remove saved network
- `WiFiHiddenDialog`: Connect to hidden network

All dialogs follow the `NetworkModal` pattern from dialogs-common.jsx.

### Modified Components

#### `network-main.jsx`

Add WiFi section to main network page:

**Changes:**
- Import WiFi components
- Add WiFi device type filtering
- Render WiFiPage for wireless devices
- Add "Add WiFi Network" action button

#### `network-interface.jsx`

Enhance interface detail page for WiFi devices:

**Changes:**
- Detect WiFi device type
- Display WiFi-specific information:
  - SSID if connected
  - Signal strength
  - Frequency (2.4GHz/5GHz)
  - Security type
  - AP mode status
- Add quick actions for WiFi

#### `dialogs-common.jsx`

Extend NetworkAction component:

**Changes:**
- Add WiFi network creation option
- Delegate to WiFiConnectDialog or WiFiAPDialog

#### `interfaces.js`

Enhance WiFi device type handling:

**Current State:**
- WiFi device type already recognized (case 2: '802-11-wireless')
- Needs WiFi-specific helpers

**Additions:**
- `getWiFiDeviceCapabilities()`: Query device features
- `getWiFiAccessPoints()`: Fetch scanned APs
- `requestWiFiScan()`: Trigger network scan
- `getWiFiConnectionStrength()`: Signal strength helpers
- `getWiFiSecurity()`: Parse security flags

## Data Flow

### Startup Flow

```
1. NetworkManager module loads
2. Query devices via D-Bus: GetDevices()
3. Filter for DeviceType=2 (Wireless)
4. For each WiFi device:
   a. Get device properties
   b. Get active connection (if any)
   c. Request initial scan
   d. Get list of known connections
5. Render WiFi UI with initial data
```

### Network Scanning Flow

```
User Action: Click "Scan" button
    │
    ▼
Call: device.RequestScan({})
    │
    ▼
Listen: PropertiesChanged signal
    │
    ▼
When: LastScan property updates
    │
    ▼
Call: device.GetAccessPoints()
    │
    ▼
For each AP:
    - Get SSID, Strength, Flags, Security
    - Check if known connection exists
    │
    ▼
Update UI: Display network list with metadata
```

### Connection Flow

```
User Action: Select network → Enter password → Click "Connect"
    │
    ▼
Create connection settings object:
  {
    connection: {id, type: "802-11-wireless", ...},
    "802-11-wireless": {ssid, mode: "infrastructure"},
    "802-11-wireless-security": {key-mgmt, psk},
    ipv4: {method: "auto"},
    ipv6: {method: "auto"}
  }
    │
    ▼
Call: NetworkManager.AddAndActivateConnection(settings, device, ap_path)
    │
    ▼
Monitor: StateChanged signal
    │
    ├─Success: State = ACTIVATED
    │    └─→ Update UI: Show connected
    │
    └─Failure: State = FAILED
         └─→ Update UI: Show error, allow retry
```

### Access Point Mode Flow

```
User Action: Configure AP → Click "Enable"
    │
    ▼
Create AP connection settings:
  {
    connection: {id, type: "802-11-wireless", autoconnect: true},
    "802-11-wireless": {
      ssid,
      mode: "ap",
      band: "bg" or "a"
    },
    "802-11-wireless-security": {
      key-mgmt: "wpa-psk",
      psk: password
    },
    ipv4: {
      method: "shared",  # Enables DHCP server
      address-data: [{address, prefix}]
    }
  }
    │
    ▼
Call: NetworkManager.AddAndActivateConnection(settings, device, "/")
    │
    ▼
Wait: State = ACTIVATED
    │
    ▼
Verify: Device is now broadcasting SSID
    │
    ▼
Update UI: Show AP active, display connection info
```

## NetworkManager D-Bus API Integration

### Primary Interfaces

#### org.freedesktop.NetworkManager

**Methods:**
- `GetDevices()`: List all network devices
- `AddAndActivateConnection(settings, device, specific_object)`: Create and activate connection
- `ActivateConnection(connection, device, specific_object)`: Activate existing connection
- `DeactivateConnection(active_connection)`: Disconnect

**Properties:**
- `WirelessEnabled`: Global WiFi radio state
- `WirelessHardwareEnabled`: Hardware radio switch state

#### org.freedesktop.NetworkManager.Device.Wireless

**Methods:**
- `GetAccessPoints()`: List visible networks
- `GetAllAccessPoints()`: Include hidden/weak networks
- `RequestScan(options)`: Trigger network scan

**Properties:**
- `AccessPoints`: Array of AP object paths
- `ActiveAccessPoint`: Currently connected AP
- `Mode`: Infrastructure/AP/AdHoc
- `Bitrate`: Current connection speed
- `LastScan`: Timestamp of last scan
- `WirelessCapabilities`: Hardware features

#### org.freedesktop.NetworkManager.AccessPoint

**Properties:**
- `Ssid`: Network name (byte array)
- `Strength`: Signal strength (0-100)
- `Frequency`: Channel frequency (MHz)
- `Flags`, `WpaFlags`, `RsnFlags`: Security capabilities
- `Mode`: Infrastructure/AdHoc/AP

#### org.freedesktop.NetworkManager.Connection

**Properties:**
- `Settings`: Full connection configuration
- `Unsaved`: Whether settings changed since save

**Methods:**
- `Update(settings)`: Modify connection
- `Delete()`: Remove connection

#### org.freedesktop.NetworkManager.Connection.Active

**Properties:**
- `State`: Connection state
- `Default`: Is default route
- `Ip4Config`, `Ip6Config`: IP configuration paths
- `Connection`: Settings object path

**Signals:**
- `StateChanged(state, reason)`: Connection state transitions

### Connection Settings Schema

#### Client Mode WPA2 Example

```
{
  "connection": {
    "id": "Home WiFi",
    "type": "802-11-wireless",
    "uuid": "generated-uuid",
    "autoconnect": true
  },
  "802-11-wireless": {
    "ssid": [byte array of SSID],
    "mode": "infrastructure",
    "band": "bg",  // or "a" for 5GHz
    "hidden": false
  },
  "802-11-wireless-security": {
    "key-mgmt": "wpa-psk",
    "psk": "password123",
    "auth-alg": "open"
  },
  "ipv4": {
    "method": "auto"
  },
  "ipv6": {
    "method": "auto"
  }
}
```

#### Access Point Mode Example

```
{
  "connection": {
    "id": "HALOS-AP",
    "type": "802-11-wireless",
    "uuid": "generated-uuid",
    "autoconnect": false  // Manual activation
  },
  "802-11-wireless": {
    "ssid": [byte array of "HALOS-XXXXX"],
    "mode": "ap",
    "band": "bg",
    "channel": 6  // Optional, auto if omitted
  },
  "802-11-wireless-security": {
    "key-mgmt": "wpa-psk",
    "psk": "halos12345"
  },
  "ipv4": {
    "method": "shared",  // Enables DHCP server
    "address-data": [{
      "address": "10.42.0.1",
      "prefix": 24
    }]
  },
  "ipv6": {
    "method": "ignore"
  }
}
```

## State Management

### WiFi Device State

Tracked per WiFi interface:

```
{
  devicePath: string,           // D-Bus object path
  interface: string,             // e.g., "wlan0"
  hwAddress: string,             // MAC address
  mode: "infrastructure" | "ap", // Current mode
  capabilities: {
    ap: boolean,                 // Supports AP mode
    adhoc: boolean,              // Supports AdHoc
    freq_2_4ghz: boolean,
    freq_5ghz: boolean
  },
  activeConnection: {
    path: string,
    ssid: string,
    strength: number,
    security: string,
    ipv4: string,
    ipv6: string
  } | null,
  scanning: boolean,
  lastScan: number,              // Timestamp
  accessPoints: WiFiAccessPoint[]
}
```

### Access Point State

For each visible network:

```
{
  path: string,                  // D-Bus object path
  ssid: string,                  // Network name
  strength: number,              // 0-100
  frequency: number,             // MHz
  band: "2.4GHz" | "5GHz",
  security: "open" | "wpa" | "wpa2" | "wpa3",
  flags: number,                 // Raw security flags
  mode: string,
  known: boolean,                // Saved connection exists
  active: boolean                // Currently connected
}
```

### React State Hooks

Primary state management using React hooks:

```
// In WiFiPage component
const [devices, setDevices] = useState([]);
const [selectedDevice, setSelectedDevice] = useState(null);
const [accessPoints, setAccessPoints] = useState([]);
const [scanning, setScanning] = useState(false);
const [connecting, setConnecting] = useState(false);
const [error, setError] = useState(null);

// Connect to NetworkManager model (from useContext)
const model = useContext(ModelContext);
```

## UI Component Hierarchy

### Main WiFi Page

```
<WiFiPage>
  ├─ <WiFiDeviceSelector>       # If multiple WiFi interfaces
  ├─ <WiFiModeToggle>            # Client/AP mode switch
  │
  ├─ <WiFiClientMode>            # When mode=client
  │   ├─ <WiFiToolbar>
  │   │   ├─ <ScanButton>
  │   │   └─ <HiddenNetworkButton>
  │   ├─ <WiFiNetworkList>
  │   │   └─ <WiFiNetworkItem> * N
  │   │       ├─ SSID
  │   │       ├─ <SignalStrength>
  │   │       ├─ <SecurityBadge>
  │   │       └─ <ConnectionStatus>
  │   └─ <WiFiSavedNetworks>
  │       └─ <SavedNetworkItem> * N
  │
  └─ <WiFiAPMode>                # When mode=ap
      ├─ <APStatusCard>
      │   ├─ SSID display
      │   ├─ Client count
      │   ├─ IP range
      │   └─ QR code (optional)
      └─ <APConfigButton>
```

### PatternFly Components Used

Following Cockpit standards:

- `Card`: Container for sections
- `CardHeader`, `CardTitle`, `CardBody`: Card structure
- `List`, `ListItem`: Network lists
- `Button`: Actions
- `Modal`: Dialogs
- `Form`, `FormGroup`: Input forms
- `TextInput`, `PasswordInput`: Form fields
- `Select`: Dropdowns
- `Alert`: Error/success messages
- `Progress`: Signal strength
- `Badge`: Security type, status
- `EmptyState`: No networks found
- `Spinner`: Loading states

### WiFi-Specific Components

#### Signal Strength Indicator

```
<SignalStrength strength={75} />

Renders:
▁▃▅▇█ (5 bars, 4 filled based on strength)
```

Uses PatternFly Progress or custom CSS for visual indicator.

#### Security Badge

```
<SecurityBadge type="wpa2" />

Renders: [🔒 WPA2]
```

Color-coded badge:
- Open: Gray (warning)
- WPA/WPA2: Blue
- WPA3: Green

#### Connection Status

```
<ConnectionStatus state="connected" ssid="Home WiFi" />

Renders: ✓ Connected to "Home WiFi"
```

#### Network List Item

```
<WiFiNetworkItem
  ssid="My Network"
  strength={85}
  security="wpa2"
  connected={false}
  known={true}
  onClick={() => onConnectClick()}
/>
```

## Error Handling

### Connection Errors

NetworkManager provides state change reasons. Map to user-friendly messages:

**Common Errors:**
- `NM_DEVICE_STATE_REASON_NO_SECRETS`: Wrong password
- `NM_DEVICE_STATE_REASON_SUPPLICANT_DISCONNECT`: Authentication failed
- `NM_DEVICE_STATE_REASON_SUPPLICANT_TIMEOUT`: Network out of range
- `NM_DEVICE_STATE_REASON_IP_CONFIG_UNAVAILABLE`: DHCP failed

**Error Display:**
```
<Alert variant="danger">
  <AlertTitle>Connection Failed</AlertTitle>
  <AlertDescription>
    Incorrect password for "Home WiFi". Please try again.
  </AlertDescription>
  <AlertActionButton onClick={retry}>Retry</AlertActionButton>
</Alert>
```

### Graceful Degradation

**No WiFi Hardware:**
```
<EmptyState>
  <EmptyStateIcon icon={WifiIcon} />
  <Title>No WiFi Devices</Title>
  <EmptyStateBody>
    This system does not have any WiFi network adapters.
  </EmptyStateBody>
</EmptyState>
```

**WiFi Disabled:**
```
<Alert variant="info">
  WiFi is disabled.
  <Button onClick={enableWiFi}>Enable WiFi</Button>
</Alert>
```

## Testing Strategy

### Unit Tests

Not typically used in Cockpit (integration tests preferred), but consider:

- SSID byte array conversion helpers
- Security flag parsing
- Signal strength calculations

### Integration Tests

Primary testing approach following Cockpit patterns:

**Location:** `test/verify/check-networkmanager-wifi`

**Test Framework:** Python with Cockpit's test API

**Test Structure:**
```
class TestWiFi(netlib.NetworkCase):
    def testBasic(self):
        # Test basic WiFi page loads

    def testScan(self):
        # Test network scanning

    def testConnect(self):
        # Test connecting to WPA2 network

    def testAP(self):
        # Test Access Point mode

    def testSimultaneous(self):
        # Test AP + Client simultaneously
```

**Test Environment:**
- Use virtual WiFi devices (mac80211_hwsim kernel module)
- Simulate multiple access points
- Test on actual Raspberry Pi hardware

### Manual Testing Checklist

**Client Mode:**
- [ ] Scan finds networks
- [ ] Connect to WPA2 network
- [ ] Connect to open network (with warning)
- [ ] Connect to hidden network
- [ ] Disconnect from network
- [ ] Forget saved network
- [ ] Auto-reconnect to known network
- [ ] Wrong password shows clear error
- [ ] Network out of range handled gracefully

**Access Point Mode:**
- [ ] Enable AP with default settings
- [ ] Customize SSID and password
- [ ] Clients can connect to AP
- [ ] AP provides DHCP addresses
- [ ] Disable AP

**Edge Cases:**
- [ ] Switch between Client and AP modes
- [ ] Multiple WiFi interfaces handled
- [ ] WiFi enable/disable
- [ ] Hardware removal during operation
- [ ] Session survives IP address change

## Performance Considerations

### Scan Frequency

Balance freshness vs. performance:
- Auto-scan on page load
- Throttle manual scans to max 1 per 5 seconds
- Background refresh every 30 seconds if page active
- Pause scanning if tab not visible (Page Visibility API)

### Access Point List Optimization

- Limit displayed APs to 50 strongest
- Virtual scrolling for large lists (PatternFly Virtualized List)
- Debounce filtering/search
- Cache AP metadata between scans

### D-Bus Connection Management

- Reuse existing Cockpit D-Bus connections
- Subscribe to signals only when WiFi page active
- Unsubscribe on page unmount
- Batch property reads where possible

## Security Considerations

### Credential Handling

**Never:**
- Display existing WiFi passwords
- Log passwords to browser console
- Include passwords in URLs or error messages
- Store passwords in browser localStorage

**Always:**
- Use PasswordInput component (masked by default)
- Pass passwords only in connection settings
- Let NetworkManager handle credential storage
- Clear password from state after connection attempt

### Privilege Escalation

Leverage Cockpit's existing authentication:

- WiFi configuration requires `NetworkManager` polkit privilege
- Cockpit handles privilege escalation UI
- All D-Bus calls subject to NetworkManager's polkit policy

### Input Validation

**SSID:**
- Maximum 32 bytes (UTF-8 may be fewer characters)
- Any characters allowed (NetworkManager handles encoding)

**Password:**
- WPA2/WPA3: 8-63 characters
- Validate length before connection attempt
- Show validation errors inline

### Open Network Warning

Before connecting to unsecured network:
```
<Alert variant="warning">
  <AlertTitle>Unsecured Network</AlertTitle>
  <AlertDescription>
    "{ssid}" does not use encryption. Your data may be visible to others.
  </AlertDescription>
  <AlertActionButtons>
    <Button variant="danger" onClick={connect}>Connect Anyway</Button>
    <Button variant="link" onClick={cancel}>Cancel</Button>
  </AlertActionButtons>
</Alert>
```

## Internationalization

Use Cockpit's standard i18n:

```
import { _cockpit } from "cockpit";
const _ = _cockpit.gettext;

// In component:
<Button>{_("Scan for Networks")}</Button>
<Alert>{_("Connection failed")}</Alert>
```

**Translatable Strings:**
- All UI labels and buttons
- Error messages
- Dialog titles and descriptions
- Security type names
- Connection status messages

**Not Translated:**
- SSID names (user-provided)
- Technical D-Bus property names
- MAC addresses, IP addresses

## Accessibility

Follow Cockpit and PatternFly accessibility standards:

**Keyboard Navigation:**
- All interactive elements focusable
- Logical tab order
- Enter/Space activate buttons
- Arrow keys navigate lists
- Escape closes dialogs

**Screen Readers:**
- ARIA labels for all icons
- ARIA live regions for status changes
- Form field labels properly associated
- Error messages announced
- Loading states announced

**Visual:**
- Color not sole indicator (use icons + text)
- Sufficient contrast ratios
- Focus indicators visible
- Text resizable without breaking layout

## Deployment Architecture

### HaLOS Packaging

See Phase 3.0 implementation for detailed packaging approach:

**Package:** `cockpit-networkmanager-halos`

**Contents:**
- Modified networkmanager module files
- WiFi components and dialogs
- Updated manifest.json
- Translations (po files)

**Dependencies:**
- `cockpit-bridge (>= 276)`
- `network-manager (>= 1.20)`
- `wpasupplicant`
- `hostapd` (for AP mode)

**Conflicts:**
- `cockpit-networkmanager` (replaces standard package)

### Build Process

Following Cockpit's build system:

1. Run `./build.js networkmanager`
2. Output to `dist/networkmanager/`
3. Package dist files into .deb
4. Install to `/usr/share/cockpit/networkmanager/`

## Migration and Compatibility

### Existing Installations

- WiFi devices previously showed as generic "Ethernet" type
- Existing WiFi connections remain functional
- New WiFi features appear after module update
- No data migration required

### Backwards Compatibility

- Code compatible with Cockpit 276+
- NetworkManager 1.20+ (WiFi API stable)
- Graceful degradation on older NetworkManager versions

## Future Architecture Considerations

### Potential Enhancements

**WPA Enterprise Support:**
- Additional security type dialogs
- Certificate management integration
- RADIUS configuration UI

**Network Profiles:**
- Location-based automatic switching
- Priority/preference management
- Profile import/export

**Advanced Diagnostics:**
- Channel utilization graphs
- Packet statistics
- Connection quality history

### Upstream Contribution Path

Architecture decisions supporting upstream contribution:

1. **Zero HaLOS-specific code**: All features generic
2. **Follow Cockpit patterns exactly**: Based on wireguard.jsx
3. **No external dependencies**: Only NetworkManager
4. **Comprehensive tests**: Integration test coverage
5. **Documentation**: Inline comments, this architecture doc

When contributing upstream:
- Separate concerns (no HaLOS mentions)
- Ensure all tests pass
- Video demonstration
- Responsive to code review feedback

## Conclusion

This architecture provides a solid foundation for comprehensive WiFi support in Cockpit's NetworkManager module. By following established patterns and leveraging NetworkManager's robust D-Bus API, the implementation will be maintainable, testable, and suitable for both HaLOS deployment and potential upstream contribution.

The modular design allows incremental implementation:
1. Basic client mode (connect to networks)
2. Access Point mode
3. Advanced features (hidden networks, simultaneous modes)
4. Polish and optimization

Each phase deliverable and independently valuable, while building toward the complete vision outlined in WIFI_SPEC.md.
