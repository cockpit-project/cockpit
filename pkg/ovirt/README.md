# Cockpit VM Management with oVirt
This plugin extends `pkg/machines` for oVirt specifics if the server is used as a host within an oVirt cluster.

## Installation
Since there is no way how to determine the URL of `oVirt` or `RHV (Red Hat Virtualization)` engine which the server is managed by, user/administrator must provide this configuration.

To do so, the `root` must do one of following one-time action:

  - ```either```
    - log into Cockpit
    - visit `oVirt Machines` page
    - provide oVirt's engine URL within dialog
    - **Re-login** to Cockpit
  - ```or``` execute in terminal:
    - `/usr/share/cockpit/ovirt/install.sh https://[FQDN]/ovirt-engine`
    
By any of the actions above, following files are generated: 

  - /usr/share/cockpit/ovirt/machines-ovirt.config - feel free to adjust
  - /usr/share/cockpit/ovirt/override.json - to ease Content Security Policy towards oVirt's REST API
  
  