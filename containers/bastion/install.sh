#!/bin/sh

set -ex

if [ -z "$INSTALLER" ]; then
    INSTALLER="dnf"
fi

if [ -z "$OFFLINE" ]; then
    "$INSTALLER" -y update
    "$INSTALLER" install -y python3 openssl systemd
fi

# Check for prebuilt rpms in /container/rpms
# If not present there, they are fetched from dnf
local_ws=$(ls /container/rpms/cockpit-ws-*.rpm || true)
if [ -n "$local_ws" ]; then
    rpm -i "$local_ws" $(ls /container/rpms/cockpit-bridge-*.rpm)
else
    "$INSTALLER" install -y cockpit-ws cockpit-bridge
fi

rm -rf /container/scripts
rm -rf /container/rpms

chmod 775 /container
ln -sf /container/brand /etc/os-release

# We link in a customized config file
# We may also need to generate certificates
rm -rf /etc/cockpit/
mkdir -p /etc/cockpit/
mkdir -p /etc/cockpit/ws-certs.d
chmod 775 /etc/cockpit
ln -sf /container/cockpit.conf /etc/cockpit/cockpit.conf

"$INSTALLER" clean all


