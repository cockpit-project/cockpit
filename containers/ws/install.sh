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
$INSTALL iproute procps-ng vim-minimal netcat

arch=`uname -p`
rpm=$(ls /container/rpms/cockpit-ws-*$OSVER.*$arch.rpm /container/rpms/cockpit-bridge-*$OSVER.*$arch.rpm || true)

# If there are rpm files in the current directory we'll install those
if [ -n "$rpm" ]; then
    $INSTALL /container/rpms/cockpit-ws-*$OSVER.*$arch.rpm /container/rpms/cockpit-bridge-*$OSVER.*$arch.rpm
else
    # pull packages from PR packit COPR
    curl -o /build/etc/yum.repos.d/cockpit.repo https://copr.fedorainfracloud.org/coprs/packit/cockpit-project-cockpit-17473/repo/fedora-${OSVER}/packit-cockpit-project-cockpit-17473-fedora-36.repo
    ws=$(package_name "cockpit-ws")
    bridge=$(package_name "cockpit-bridge")
    $INSTALL "$ws" "$bridge"
fi

mkdir -p /build/usr/local/bin/
curl -L -o /build/usr/local/bin/websocat https://github.com/vi/websocat/releases/download/v1.10.0/websocat.x86_64-unknown-linux-musl
chmod a+x /build/usr/local/bin/websocat
echo 'exec websocat -b -s 0.0.0.0:8080' > /build/usr/local/bin/socat-session.sh
echo 'exec nc -U /tmp/authsock' > /build/usr/local/bin/nc-authsock-session.sh
chmod a+x /build/usr/local/bin/socat-session.sh /build/usr/local/bin/nc-authsock-session.sh

# HACK: fix for older cockpit-certificate-helper
sed -i '/^COCKPIT_GROUP=/ s/=.*$/=/; s_/etc/machine-id_/dev/null_' /build/usr/libexec/cockpit-certificate-helper

rm -rf /build/var/cache/dnf /build/var/lib/dnf /build/var/lib/rpm* /build/var/log/*
rm -rf /container/rpms || true
