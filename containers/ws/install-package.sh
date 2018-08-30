#!/bin/sh

set -ex

package_name()
{
    package="$1"
    if [ -n "$VERSION" ]; then
        package="$package-$VERSION"
    fi
    echo "$package"
}

OSVER=$(. /etc/os-release && echo "$VERSION_ID")

if [ -z "$INSTALLER" ]; then
    INSTALLER="dnf"
fi

"$INSTALLER" -y update
"$INSTALLER" install -y sed

arch=`uname -p`
rpm=$(ls /container/rpms/cockpit-ws-*$OSVER.*$arch.rpm /container/rpms/cockpit-bridge-*$OSVER.*$arch.rpm /container/rpms/cockpit-dashboard-*$OSVER.*$arch.rpm || true)

# If there are rpm files in the current directory we'll install those
if [ -n "$rpm" ]; then
    $INSTALLER -y install /container/rpms/cockpit-ws-*$OSVER.*$arch.rpm /container/rpms/cockpit-bridge-*$OSVER.*$arch.rpm /container/rpms/cockpit-dashboard-*$OSVER.*$arch.rpm
else
    ws=$(package_name "cockpit-ws")
    bridge=$(package_name "cockpit-bridge")
    dashboard=$(package_name "cockpit-dashboard")
    "$INSTALLER" -y install "$ws" "$bridge" "$dashboard"
fi

"$INSTALLER" clean all
rm -rf /container/rpms || true

# And the stuff that starts the container
ln -s /host/proc/1 /container/target-namespace
chmod -v +x /container/atomic-install
chmod -v +x /container/atomic-uninstall
chmod -v +x /container/atomic-run
