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
"$INSTALLER" install -y util-linux-core sed

arch=`uname -p`
rpm=$(ls /container/rpms/cockpit-ws-*$OSVER.*$arch.rpm /container/rpms/cockpit-bridge-*$OSVER.*$arch.rpm || true)

# If there are rpm files in the current directory we'll install those
if [ -n "$rpm" ]; then
    $INSTALLER -y install /container/rpms/cockpit-ws-*$OSVER.*$arch.rpm /container/rpms/cockpit-bridge-*$OSVER.*$arch.rpm
else
    # pull packages from https://copr.fedorainfracloud.org/coprs/g/cockpit/cockpit-preview/
    echo -e '[group_cockpit-cockpit-preview]\nname=Copr repo for cockpit-preview owned by @cockpit\nbaseurl=https://copr-be.cloud.fedoraproject.org/results/@cockpit/cockpit-preview/fedora-$releasever-$basearch/\ntype=rpm-md\ngpgcheck=1\ngpgkey=https://copr-be.cloud.fedoraproject.org/results/@cockpit/cockpit-preview/pubkey.gpg\nrepo_gpgcheck=0\nenabled=1\nenabled_metadata=1' > /etc/yum.repos.d/cockpit.repo
    ws=$(package_name "cockpit-ws")
    bridge=$(package_name "cockpit-bridge")
    "$INSTALLER" -y install "$ws" "$bridge"
fi

"$INSTALLER" clean all
rm -rf /container/rpms || true

# And the stuff that starts the container
ln -s /host/proc/1 /container/target-namespace
chmod -v +x /container/label-install /container/label-uninstall /container/label-run
