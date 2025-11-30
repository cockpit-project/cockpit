# Cockpit NetworkManager HaLOS - Development Notes

**LAST MODIFIED**: 2025-11-30

This document contains important findings and notes for AI-assisted development of the Cockpit NetworkManager module for HaLOS.

## PatternFly Component Import Patterns

**CRITICAL**: This Cockpit fork uses specific PatternFly versions with important import patterns that differ from standard PatternFly documentation.

### Correct Import Patterns

1. **Table Components** - Import from `@patternfly/react-table`, NOT from `@patternfly/react-core`:
   ```javascript
   // ✅ CORRECT
   import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';

   // ❌ WRONG - will fail to build
   import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-core/dist/esm/components/Table/index.js';
   ```

2. **CardHeader Actions** - Use the `actions` prop pattern, NOT `CardActions` component:
   ```javascript
   // ✅ CORRECT
   <CardHeader actions={{
       actions: (
           <>
               <Button variant="secondary">Action 1</Button>
               <Button variant="danger">Action 2</Button>
           </>
       )
   }}>
       <CardTitle>Title</CardTitle>
   </CardHeader>

   // ❌ WRONG - CardActions doesn't exist in this version
   <CardHeader>
       <CardTitle>Title</CardTitle>
       <CardActions>
           <Button>Action</Button>
       </CardActions>
   </CardHeader>
   ```

3. **Standard Components** - Import from `@patternfly/react-core/dist/esm/components/...`:
   ```javascript
   import { Card, CardBody, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
   import { Button } from '@patternfly/react-core/dist/esm/components/Button/index.js';
   import { Alert } from '@patternfly/react-core/dist/esm/components/Alert/index.js';
   ```

### Reference Examples

- **Table usage**: See `pkg/lib/cockpit-components-table.tsx` for the internal ListingTable wrapper
- **CardHeader with actions**: See `pkg/networkmanager/network-interface.jsx` and `pkg/networkmanager/network-main.jsx`

## Build and Deployment Workflow

### Local Development Build

When developing locally with the `cockpit-networkmanager-halos` packaging repository:

1. **Source Location**: The build script expects the cockpit source at `../cockpit` (relative to the packaging repo)

2. **Staging Process**: The build script copies source to `cockpit-src-local/` before building
   - This staging is done ONCE at the start of the build
   - If you make changes after staging, you must rebuild to re-stage

3. **Build Command**:
   ```bash
   cd cockpit-networkmanager-halos
   ./run build --local && ./run deploy
   ```

4. **Common Issue**: If deployment shows old code, it means the source was staged before your commits
   - Solution: Run the build command again - it will re-stage the current source

### Verifying Deployment

After deployment to a test device (e.g., halos.local):

```bash
# Check if new code is deployed (search for a unique symbol from your changes)
ssh mairas@halos.local "grep -c 'YourNewComponentName' /usr/share/cockpit/networkmanager/networkmanager.js"

# File timestamps may show old dates - this is normal (reproducible builds preserve git commit timestamps)
```

### Browser Cache

After deployment, users may need to hard-refresh Cockpit in their browser:
- **macOS**: Cmd+Shift+R
- **Linux/Windows**: Ctrl+Shift+R

## WiFi Access Point Implementation (Issue #5)

Implemented components:
- **WiFiAPClientList**: Monitors DHCP lease file at `/var/lib/NetworkManager/dnsmasq-<interface>.leases`
- **WiFiAPConfig**: Status display card with Configure/Disable buttons
- **Enhanced WiFiAPDialog**: Channel selection, hidden SSID, custom IP configuration
- **Mode Detection**: `getWiFiMode()` helper distinguishes AP vs client mode

Key files:
- Implementation: `pkg/networkmanager/wifi.jsx`
- Tests: `test/verify/check-networkmanager-wifi`
- Documentation: `pkg/networkmanager/docs/IMPLEMENTATION_PLAN_ISSUE_5.md`

## Common Gotchas

1. **Import Errors**: Always check existing code for import patterns before adding new components
2. **Build Caching**: The staging directory (`cockpit-src-local`) is reused - rebuild if changes don't appear
3. **File Timestamps**: Deployed files show git commit timestamps, not deployment time
4. **Browser Cache**: Always hard-refresh after deployment
