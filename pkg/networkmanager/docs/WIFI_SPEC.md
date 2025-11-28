# WiFi Network Configuration - Technical Specification

**Version**: 1.0
**Last Modified**: 2025-11-28
**Status**: Draft

## Project Overview

This specification defines WiFi network configuration capabilities for Cockpit's NetworkManager module. The implementation enables users to configure wireless networks through the Cockpit web interface, addressing a significant feature gap in the current NetworkManager module.

### Primary Use Case: HaLOS Initial Setup

HaLOS (Hat Labs Operating System) devices ship preconfured with a WiFi Access Point enabled for initial headless configuration. Users need the ability to:

1. Connect to the device's initial WiFi hotspot
2. Access the Cockpit web interface
3. Configure the device to connect to their existing WiFi network as a client
4. Optionally reconfigure or disable the Access Point mode

This workflow must be reliable and intuitive, as it's the primary onboarding experience for HaLOS users.

## Goals

1. **Complete WiFi Support**: Enable full WiFi network configuration through Cockpit's web interface
2. **Headless Configuration**: Support initial device setup without physical access or displays
3. **User-Friendly**: Provide an intuitive interface matching the quality of desktop WiFi managers
4. **Secure by Default**: Implement proper security for WiFi credentials and connections
5. **Upstream Contribution**: Design for potential contribution back to Cockpit project

## Core Features

### 1. Network Scanning

Users must be able to discover available WiFi networks in range:

- Automatic scanning when WiFi page is accessed
- Manual refresh capability
- Display of network properties:
  - SSID (network name)
  - Signal strength (visual indicator)
  - Security type (Open, WPA2, WPA3, WPA2/WPA3)
  - Frequency band (2.4GHz, 5GHz) if available
  - Connection status (connected, saved, available)
- Support for hidden networks (manual SSID entry)
- Reasonable scan frequency to balance UX and performance

### 2. Client Mode: Connect to Existing Networks

Enable devices to connect to existing WiFi infrastructure:

**Open Networks:**
- One-click connection to unsecured networks
- Clear warning about security implications

**WPA2/WPA3 Personal Networks:**
- Password entry dialog
- Show/hide password toggle
- Save credentials for automatic reconnection
- Password strength indicator
- Support for both WPA2 and WPA3 where available

**Network Priority:**
- Automatically connect to strongest known network
- Manual priority adjustment for saved networks
- Forget network capability

**Connection Management:**
- Connect to new network
- Disconnect from current network
- Switch between saved networks
- Remove saved network credentials
- View connection details (IP, DNS, gateway, etc.)

### 3. Access Point Mode

Configure device as a WiFi hotspot:

**Basic AP Configuration:**
- SSID (network name) configuration
- Frequency band selection (2.4GHz, 5GHz if supported)
- Password setting (minimum 8 characters for WPA2)
- Security type selection (Open, WPA2, WPA3)
- Channel selection (auto or manual)
- SSID visibility (broadcast or hidden)

**AP + Client Simultaneous Mode:**
- Support running both AP and client simultaneously where hardware permits
- Clear indication of which interface is in which mode
- Separate configuration for AP and client connections

**IP Configuration for AP:**
- Automatic DHCP server setup for AP clients
- Configurable IP range for DHCP pool
- Gateway and DNS configuration

### 4. Security Requirements

**Credential Protection:**
- Never display existing WiFi passwords
- Secure storage of WiFi credentials via NetworkManager
- No credential logging in browser console or system logs
- Clear warnings before connecting to open networks

**Password Requirements:**
- WPA2/WPA3: Minimum 8 characters, maximum 63 characters
- Character validation appropriate to security type
- Password strength feedback

**Permission Model:**
- Leverage existing Cockpit authentication
- Require elevated privileges for network changes
- Session timeout for security-sensitive operations

## User Workflows

### Workflow 1: Initial HaLOS Device Setup

**Scenario**: User receives new HaLOS device and needs to connect it to their home WiFi.

1. Device boots with pre-configured AP (SSID: "HALOS-XXXXX")
2. User connects laptop/phone to HALOS AP using default password
3. User navigates to https://halos.local:9090 in browser
4. User logs into Cockpit interface
5. User navigates to Network > WiFi section
6. System displays available networks (scanned automatically)
7. User selects their home network from list
8. User enters WiFi password
9. User clicks "Connect"
10. Device connects to home network as client
11. User can now access device via home network
12. (Optional) User reconfigures or disables AP mode

**Success Criteria:**
- Entire workflow completable without keyboard/monitor on device
- Clear feedback at each step
- Graceful error handling if connection fails
- Device remains accessible even if WiFi connection fails

### Workflow 2: Changing WiFi Networks

**Scenario**: User needs to connect device to different WiFi network (moved location, network change).

1. User accesses Cockpit interface
2. User navigates to Network > WiFi
3. User sees currently connected network highlighted
4. User clicks "Scan" to refresh available networks
5. User selects new network
6. User enters credentials if required
7. User confirms connection
8. Device disconnects from old network and connects to new one
9. User connection redirects to new IP if necessary

**Success Criteria:**
- Minimal connection interruption
- Clear indication of current vs. target network
- Rollback capability if new connection fails

### Workflow 3: Configuring WiFi Access Point

**Scenario**: User wants to enable or reconfigure device as WiFi hotspot.

1. User accesses Network > WiFi > Access Point tab
2. User clicks "Enable Access Point" (or "Configure" if already enabled)
3. Dialog shows AP configuration options:
   - SSID (pre-filled with generated name)
   - Password (minimum 8 characters)
   - Security type
   - Frequency band
4. User customizes settings as needed
5. User saves configuration
6. System enables AP mode
7. New network becomes visible to other devices

**Success Criteria:**
- Secure defaults pre-configured
- Clear indication of AP status (enabled/disabled)
- SSID not conflicting with nearby networks
- Password meets security requirements

## Reference Implementation

The user interface and feature set should match the Raspberry Pi `pplug-netman` Network Manager tray applet and `lp-connection-editor` tools:

**Key UX Patterns from pplug-netman:**
- Network list with signal strength visualization
- Quick connect/disconnect actions
- Clear indication of active connection
- Scan for networks on demand
- Minimal clicks to common operations

**Configuration Depth from lp-connection-editor:**
- Comprehensive security options
- Advanced IP configuration when needed
- Clear organization of settings
- Validation and helpful error messages

## Non-Functional Requirements

### Performance

- Network scan completion: < 10 seconds
- Connection establishment: < 30 seconds typical
- UI responsiveness: < 100ms for interactions
- Handle up to 50 visible networks gracefully

### Reliability

- Robust error handling for all NetworkManager operations
- Graceful degradation if WiFi hardware unavailable
- Connection retry logic with exponential backoff
- Clear error messages for common failure cases

### Usability

- No specialized networking knowledge required
- Mobile-responsive design
- Accessible (ARIA labels, keyboard navigation)
- Internationalization support via Cockpit's i18n system

### Compatibility

- Works with all WiFi hardware supported by NetworkManager
- Tested on Raspberry Pi 3/4/5 (primary HaLOS targets)
- Compatible with Cockpit 276+
- Supports NetworkManager 1.20+

## Technical Constraints

### Must Use

- NetworkManager D-Bus API for all WiFi operations
- PatternFly 6 components for UI consistency
- React 18 with hooks (matching Cockpit standards)
- Cockpit's authentication and privilege escalation
- Standard Cockpit i18n for translations

### Must Not

- Bypass NetworkManager to configure wpa_supplicant directly
- Store WiFi credentials outside NetworkManager
- Require additional backend services beyond NetworkManager
- Break existing Cockpit networkmanager functionality

## Out of Scope

The following features are explicitly excluded from initial implementation:

### WPA Enterprise (802.1X)

Enterprise authentication methods (RADIUS, PEAP, TTLS, etc.) are deferred to a future phase:
- Complexity requires extensive testing infrastructure
- Less common in target use cases (home, small boat/RV networks)
- Would significantly extend development timeline

### Mesh Networking

802.11s mesh capabilities are not included:
- Specialized use case with limited demand
- Requires different UX paradigm
- NetworkManager mesh support varies

### WiFi Direct

Peer-to-peer WiFi connections excluded:
- Different use case than infrastructure networking
- Limited overlap with primary use cases
- Requires separate UI design

### Advanced Tuning

Power management, TX power, regulatory domain configuration:
- Rarely needed by target users
- Can be added in future iterations
- Available via NetworkManager CLI for advanced users

### Mobile Broadband

Cellular/3G/4G/5G connections handled separately:
- Different technology stack
- Separate UI requirements
- May be addressed in future NetworkManager work

## Success Metrics

### Must Have (MVP)

- [ ] Users can scan for WiFi networks
- [ ] Users can connect to WPA2 networks
- [ ] Users can disconnect from networks
- [ ] Users can configure device as Access Point
- [ ] HaLOS initial setup workflow works end-to-end
- [ ] Works reliably on Raspberry Pi hardware
- [ ] No security vulnerabilities in credential handling
- [ ] UI matches Cockpit design standards

### Should Have

- [ ] Support for WPA3 networks
- [ ] Hidden network configuration
- [ ] Network priority management
- [ ] Detailed connection information display
- [ ] Graceful error recovery

### Nice to Have

- [ ] Signal strength history graphs
- [ ] Network quality metrics
- [ ] Speed test integration
- [ ] QR code for easy AP sharing

## Dependencies

### External

- NetworkManager >= 1.20 (WiFi support mature in this version)
- wpa_supplicant (pulled in by NetworkManager)
- hostapd (for AP mode)
- Cockpit >= 276 (current stable)

### Internal

- Existing Cockpit networkmanager module code
- Cockpit authentication system
- PatternFly React components
- Cockpit's D-Bus bridge

## Risks and Mitigations

### Risk: WiFi hardware compatibility variations

**Impact**: High - Feature unusable on incompatible hardware
**Mitigation**:
- Test on range of Raspberry Pi models
- Graceful degradation if WiFi unavailable
- Clear error messages for unsupported hardware

### Risk: NetworkManager D-Bus API changes

**Impact**: Medium - Code breaks on NM updates
**Mitigation**:
- Test against multiple NetworkManager versions
- Use stable D-Bus APIs
- Monitor NetworkManager release notes

### Risk: Simultaneous AP + Client mode support varies

**Impact**: Medium - Can't run both modes on some hardware
**Mitigation**:
- Detect hardware capabilities
- Disable unsupported combinations
- Clear messaging to users

### Risk: WiFi connection interrupts Cockpit session

**Impact**: Medium - Poor user experience during network changes
**Mitigation**:
- Connection transition logic with retry
- Keep session alive across IP changes where possible
- Clear reconnection instructions

## Validation Criteria

### Functional Testing

- All user workflows complete successfully
- Error handling verified for common failure cases
- Security requirements validated (no credential leaks)
- Performance meets specified targets

### Hardware Testing

- Works on Raspberry Pi 3, 4, 5
- Works on x86_64 with common WiFi adapters
- AP mode tested with multiple client devices
- Simultaneous AP + Client tested where supported

### Integration Testing

- No regression in existing networkmanager functionality
- Works with other Cockpit modules
- Authentication and privilege escalation work correctly
- Settings persist across reboots

### Upstream Readiness

- Code follows Cockpit code style standards
- Integration tests written and passing
- Documentation updated
- Video demonstration created
- Community feedback addressed

## Future Enhancements

Features deferred to post-MVP releases:

1. **WPA Enterprise Support**: Full 802.1X authentication
2. **Connection Profiles**: Named profiles for common locations
3. **VPN Integration**: Auto-VPN when on specific networks
4. **Bandwidth Monitoring**: Track WiFi data usage
5. **Advanced Diagnostics**: Packet capture, channel analysis
6. **Bluetooth Tethering**: Share connection via Bluetooth
7. **Captive Portal Detection**: Auto-open portal login pages
8. **Guest Network**: Isolated guest AP configuration

## Glossary

- **AP**: Access Point - device providing WiFi network
- **Client Mode**: Device connecting to existing WiFi network
- **SSID**: Service Set Identifier - WiFi network name
- **WPA2/WPA3**: WiFi Protected Access - security protocols
- **NetworkManager**: Linux network configuration daemon
- **Cockpit**: Web-based Linux server administration interface
- **HaLOS**: Hat Labs Operating System - Raspberry Pi-based system
- **D-Bus**: Inter-process communication system
- **PatternFly**: Red Hat's design system and React components
