#!/bin/sh

set -ex

dnf -y update
dnf install -y sed

OS=$(rpm -q --qf "%{release}" basesystem | sed -n -e 's/^[0-9]*\.\(\S\+\).*/\1/p')

rpm=$(ls /container/rpms/cockpit-ws*.rpm || true)

if [ -z "$RELEASE" ]; then
    RELEASE=1
fi

# If there are rpm files in the current directory we'll install those
if [ -n "$rpm" ]; then
    dnf -y install /container/rpms/cockpit-ws*.rpm

# If there is a url set, pull the version from there
# requires the build arg VERSION to be set
elif [ -n "$COCKPIT_RPM_URL" ]; then
    dnf -y install "$COCKPIT_RPM_URL/$VERSION/$RELEASE.$OS/x86_64/cockpit-ws-$VERSION-$RELEASE.$OS.x86_64.rpm"

# Otherwise just do the standard install
# requires the build arg VERSION to be set
else
    dnf -y install cockpit-ws-$VERSION-$RELEASE.$OS
fi

dnf clean all
rm -rf /container/rpms || true

# And the stuff that starts the container
ln -s /host/proc/1 /container/target-namespace
chmod -v +x /container/atomic-install
chmod -v +x /container/atomic-uninstall
chmod -v +x /container/atomic-run
