#!/bin/sh
# This script is meant to be run on an ephemeral CI host, for packit/Fedora/RHEL gating.
set -eux

TESTS="$(realpath $(dirname "$0"))"
if [ -d source ]; then
    # path for standard-test-source
    SOURCE="$(pwd)/source"
else
    SOURCE="$(realpath $TESTS/..)"
fi
LOGS="$(pwd)/logs"
mkdir -p "$LOGS"
chmod a+w "$LOGS"

# show some system info
nproc
free -h
rpm -q cockpit-system

# install browser; on RHEL, use chromium from epel
# HACK: chromium-headless ought to be enough, but version 88 has a crash: https://bugs.chromium.org/p/chromium/issues/detail?id=1170634
if ! rpm -q chromium; then
    if grep -q 'ID=.*rhel' /etc/os-release; then
        dnf install -y https://dl.fedoraproject.org/pub/epel/epel-release-latest-8.noarch.rpm
        dnf config-manager --enable epel
    fi
    dnf install -y chromium
fi

# HACK: setroubleshoot-server crashes/times out randomly (breaking TestServices),
# and is hard to disable as it does not use systemd
if rpm -q setroubleshoot-server; then
    dnf remove -y setroubleshoot-server
fi

if grep -q 'ID=.*fedora' /etc/os-release; then
    # required by TestLogin.testBasic, but tcsh is not available in CentOS/RHEL
    dnf install -y tcsh
fi

# make libpwquality less aggressive, so that our "foobar" password works
printf 'dictcheck = 0\nminlen = 6\n' >> /etc/security/pwquality.conf

# set root password for logging in
echo root:foobar | chpasswd

# create user account for logging in
if ! id admin 2>/dev/null; then
    useradd -c Administrator -G wheel admin
    echo admin:foobar | chpasswd
fi

# create user account for running the test
if ! id runtest 2>/dev/null; then
    useradd -c 'Test runner' runtest
    # allow test to set up things on the machine
    mkdir -p /root/.ssh
    curl https://raw.githubusercontent.com/cockpit-project/bots/master/machine/identity.pub  >> /root/.ssh/authorized_keys
    chmod 600 /root/.ssh/authorized_keys
fi
chown -R runtest "$SOURCE"

# disable core dumps, we rather investigate them upstream where test VMs are accessible
echo core > /proc/sys/kernel/core_pattern

# make sure that we can access cockpit through the firewall
systemctl start firewalld
firewall-cmd --add-service=cockpit --permanent
firewall-cmd --add-service=cockpit

# Run tests as unprivileged user
su - -c "env SOURCE=$SOURCE LOGS=$LOGS $TESTS/run-verify-host-user.sh" runtest

RC=$(cat $LOGS/exitcode)
exit ${RC:-1}
