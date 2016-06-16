#!/bin/sh

set -ex

# Install packages without dependencies
if [ -z "$VERSION" ] && [ -z "$OFFLINE" ]; then
    eval $(/container/scripts/get-version-env.sh)
fi

/container/scripts/install-rpms.sh -a noarch --nodeps cockpit-bridge- cockpit-shell-
/container/scripts/install-rpms.sh cockpit-ws-
/container/scripts/install-rpms.sh --nodeps cockpit-kubernetes-

# Remove unwanted packages
rm -rf /usr/share/cockpit/realmd/ /usr/share/cockpit/system/ /usr/share/cockpit/tuned/ /usr/share/cockpit/users/ /usr/share/cockpit/dashboard/

rm -rf /container/scripts
rm -rf /container/rpms

# Openshift will change the user
# but it will be part of gid 0
# so make the files we need group writable
rm -rf /etc/cockpit/
mkdir -p /etc/cockpit/
chmod 775 /etc
chmod 775 /etc/cockpit
chmod 775 /etc/os-release
chmod 775 /usr/share/cockpit/shell
chmod 775 /usr/share/cockpit/kubernetes

# Move kubernetes index file away so we only link it when we want it
mv /usr/share/cockpit/kubernetes/index.min.html.gz /usr/share/cockpit/kubernetes/original-index.gz
