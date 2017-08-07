# Cockpit VM Management with oVirt
This plugin extends `pkg/machines` for oVirt specifics if the server is used as a host within an oVirt cluster.

## oVirt configuration
Since the browser used by the end user supports CORS (Cross-Origin-Resource-Sharing), oVirt requires following configuration to allow access to its API from user's browser:

  - $ ssh root@[ENGINE_FQDN]  # log as `root` user in the oVirt engine machine
  - \# engine-config -s CORSSupport=true # to turn on the CORS support for REST API
  - \# engine-config -s CORSAllowDefaultOrigins=true  # to allow CORS for all configured hosts
  - \# systemctl restart ovirt-engine  # to take effect

Please note, you can allow just a single host by
  
  - \# engine-config -s CORSAllowedOrigins=[HOST_ADDRESS_OR_IP]:[COCKPIT_PORT]
  
## Installation
Since there is no way how to determine the URL of `oVirt` or `RHV (Red Hat Virtualization)` engine which the server is managed by, user/administrator must provide this configuration.

To do so, the `root` must do one of following one-time action:

  - ```either``` in Cockpit
    - log into Cockpit
    - visit the `oVirt Machines` page
    - provide oVirt's engine URL within the shown dialog
    - **Re-login** to Cockpit
  - ```or``` execute in terminal (ssh):
    - `/usr/share/cockpit/ovirt/install.sh https://[FQDN]/ovirt-engine`
    
By any of the actions above, following files are generated: 

  - /usr/share/cockpit/ovirt/machines-ovirt.config - feel free to adjust
  - /usr/share/cockpit/ovirt/override.json - to ease Content Security Policy towards oVirt's REST API
  
  