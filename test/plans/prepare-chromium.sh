#!/bin/sh
set -eux

# install browser; on RHEL, use chromium from epel
# HACK: chromium-headless ought to be enough, but version 88 has a crash: https://bugs.chromium.org/p/chromium/issues/detail?id=1170634
if ! rpm -q chromium; then
    if grep -q 'ID=.*rhel' /etc/os-release; then
        dnf install -y https://dl.fedoraproject.org/pub/epel/epel-release-latest-8.noarch.rpm
        dnf config-manager --enable epel
    fi
    dnf install -y chromium
fi

