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

dnf -y update

INSTALL="dnf install -y"
$INSTALL util-linux-core sed

arch=`uname -p`
rpm=$(ls /container/rpms/cockpit-ws-*$OSVER.*$arch.rpm /container/rpms/cockpit-bridge-*$OSVER.*$arch.rpm || true)

# If there are rpm files in the current directory we'll install those
if [ -n "$rpm" ]; then
    $INSTALL /container/rpms/cockpit-ws-*$OSVER.*$arch.rpm /container/rpms/cockpit-bridge-*$OSVER.*$arch.rpm
else
    # pull packages from https://copr.fedorainfracloud.org/coprs/g/cockpit/cockpit-preview/
    echo -e '[group_cockpit-cockpit-preview]\nname=Copr repo for cockpit-preview owned by @cockpit\nbaseurl=https://copr-be.cloud.fedoraproject.org/results/@cockpit/cockpit-preview/fedora-$releasever-$basearch/\ntype=rpm-md\ngpgcheck=1\ngpgkey=https://copr-be.cloud.fedoraproject.org/results/@cockpit/cockpit-preview/pubkey.gpg\nrepo_gpgcheck=0\nenabled=1\nenabled_metadata=1' > /etc/yum.repos.d/cockpit.repo
    ws=$(package_name "cockpit-ws")
    bridge=$(package_name "cockpit-bridge")
    $INSTALL "$ws" "$bridge"
fi

dnf clean all
rm -rf /container/rpms || true
