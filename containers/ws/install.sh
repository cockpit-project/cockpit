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

INSTALL="dnf install -y --installroot=/build --releasever=$OSVER --setopt=install_weak_deps=False"
$INSTALL coreutils-single util-linux-core sed sscg python3 openssh-clients

arch=`uname -p`
rpm=$(ls /container/rpms/cockpit-ws-*$OSVER.*$arch.rpm /container/rpms/cockpit-bridge-*$OSVER.*$arch.rpm || true)

# If there are rpm files in the current directory we'll install those
if [ -n "$rpm" ]; then
    $INSTALL /container/rpms/cockpit-ws-*$OSVER.*$arch.rpm /container/rpms/cockpit-bridge-*$OSVER.*$arch.rpm
else
    # pull packages from https://copr.fedorainfracloud.org/coprs/g/cockpit/cockpit-preview/
    echo -e '[group_cockpit-cockpit-preview]\nname=Copr repo for cockpit-preview owned by @cockpit\nbaseurl=https://copr-be.cloud.fedoraproject.org/results/@cockpit/cockpit-preview/fedora-$releasever-$basearch/\ntype=rpm-md\ngpgcheck=1\ngpgkey=https://copr-be.cloud.fedoraproject.org/results/@cockpit/cockpit-preview/pubkey.gpg\nrepo_gpgcheck=0\nenabled=1\nenabled_metadata=1' > /build/etc/yum.repos.d/cockpit.repo
    ws=$(package_name "cockpit-ws")
    bridge=$(package_name "cockpit-bridge")
    $INSTALL "$ws" "$bridge"
fi

# HACK: fix for older cockpit-certificate-helper
sed -i '/^COCKPIT_GROUP=/ s/=.*$/=/; s_/etc/machine-id_/dev/null_' /build/usr/libexec/cockpit-certificate-helper

rm -rf /build/var/cache/dnf /build/var/lib/dnf /build/var/lib/rpm* /build/var/log/*
rm -rf /container/rpms || true
