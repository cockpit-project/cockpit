#!/bin/sh

set -ex

if [ -z "$INSTALLER" ]; then
    INSTALLER="dnf"
fi

if [ -z "$OFFLINE" ]; then
    "$INSTALLER" -y update
fi

# Install packages without dependencies
/container/scripts/install-rpms.sh cockpit-ws cockpit-dashboard
/container/scripts/install-rpms.sh --nodeps cockpit-bridge
/container/scripts/install-rpms.sh -a noarch --nodeps cockpit-system
/container/scripts/install-rpms.sh --nodeps cockpit-kubernetes

# Remove unwanted packages
rm -rf /usr/share/cockpit/realmd/ /usr/share/cockpit/systemd/ /usr/share/cockpit/tuned/ /usr/share/cockpit/users/ /usr/share/cockpit/dashboard/

# Remove unwanted cockpit-bridge binaries
rm -rf /usr/bin/cockpit-bridge
rm -rf /usr/libexec/cockpit-askpass

rm -rf /container/scripts
rm -rf /container/rpms

# Openshift will change the user
# but it will be part of gid 0
# so make the files we need group writable

# We replace os-release with
# kubernetes or openshift specific text
chmod 775 /container
ln -sf /container/os-release /etc/os-release

# We link in a customized config file
# We may also need to generate certificates
rm -rf /etc/cockpit/
mkdir -p /etc/cockpit/
chmod 775 /etc/cockpit

# The index html is changed for the registry
# We also add override.json files to both these locations
chmod 775 /usr/share/cockpit/shell
chmod 775 /usr/share/cockpit/kubernetes

# Move kubernetes index file away so we only link it when we want it
mv /usr/share/cockpit/kubernetes/index.html.gz /usr/share/cockpit/kubernetes/original-index.gz || true
mv /usr/share/cockpit/kubernetes/index.min.html.gz /usr/share/cockpit/kubernetes/original-index.gz || true

"$INSTALLER" clean all
