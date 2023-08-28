#!/bin/sh

set -ex

OSVER=$(. /etc/os-release && echo "$VERSION_ID")
INSTALLROOT=/build
INSTALL="dnf install -y --installroot=$INSTALLROOT --releasever=$OSVER --setopt=install_weak_deps=False"

dnf install -y 'dnf-command(download)' cpio
$INSTALL coreutils-single util-linux-core sed sscg python3 openssh-clients

arch=`uname -p`
rpm=$(ls /container/rpms/cockpit-ws-*$OSVER.*$arch.rpm /container/rpms/cockpit-bridge-*$OSVER.*$arch.rpm || true)

unpack() {
    rpm2cpio "$1" | cpio -i --make-directories --directory=$INSTALLROOT
}

# If there are rpm files in the current directory we'll install those
# -system and -networkmanager are only for beibooting; don't install their dependencies
if [ -n "$rpm" ]; then
    $INSTALL /container/rpms/cockpit-ws-*$OSVER.*$arch.rpm /container/rpms/cockpit-bridge-*$OSVER.*$arch.rpm
    for rpm in /container/rpms/cockpit-system-*$OSVER.*$arch.rpm \
             /container/rpms/cockpit-networkmanager-*$OSVER.*$arch.rpm; do
        unpack $rpm
    done
else
    $INSTALL cockpit-ws cockpit-bridge
    dnf download cockpit-networkmanager cockpit-system
    for rpm in cockpit-networkmanager*.rpm cockpit-system*.rpm; do
        unpack $rpm
    done
fi

rm -rf /build/var/cache/dnf /build/var/lib/dnf /build/var/lib/rpm* /build/var/log/*
rm -rf /container/rpms || true
