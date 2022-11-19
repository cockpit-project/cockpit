#!/bin/sh
set -ex

OSVER=$(. /etc/os-release && echo "$VERSION_ID")

INSTALL="dnf install -y --installroot=/build --releasever=$OSVER --setopt=install_weak_deps=False"
$INSTALL coreutils-single util-linux-core sed sscg python3 openssh-clients

arch=`uname -p`
rpm=$(ls /container/rpms/cockpit-ws-*$OSVER.*$arch.rpm /container/rpms/cockpit-bridge-*$OSVER.*$arch.rpm || true)

# If there are rpm files in the current directory we'll install those
if [ -n "$rpm" ]; then
    $INSTALL /container/rpms/cockpit-ws-*$OSVER.*$arch.rpm /container/rpms/cockpit-bridge-*$OSVER.*$arch.rpm
else
    $INSTALL cockpit-ws cockpit-bridge
fi

rm -rf /build/var/cache/dnf /build/var/lib/dnf /build/var/lib/rpm* /build/var/log/*
rm -rf /container/rpms || true
