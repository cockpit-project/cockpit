#!/bin/sh

set -ex

if [ -z "$INSTALLER" ]; then
    INSTALLER="dnf"
fi

if [ -z "$OFFLINE" ]; then
    "$INSTALLER" -y update
    "$INSTALLER" install -y python3 openssl systemd
fi

/container/scripts/install-rpms.sh cockpit-ws
/container/scripts/install-rpms.sh --nodeps cockpit-bridge

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


