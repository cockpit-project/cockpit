#!/bin/sh
# This script is meant to be run on an ephemeral CI host, for packit/Fedora/RHEL gating.
set -eux

# like "basic", passed on to run-test.sh
PLAN="$1"

MYDIR="$(realpath $(dirname "$0"))"
if [ -d source ]; then
    # path for standard-test-source
    SOURCE="$(pwd)/source"
else
    SOURCE="$(realpath $MYDIR/../..)"
fi
# https://tmt.readthedocs.io/en/stable/overview.html#variables
LOGS="${TMT_TEST_DATA:-$(pwd)/logs}"
mkdir -p "$LOGS"
chmod a+w "$LOGS"

# show some system info
nproc
free -h
rpm -q cockpit-system

# install firefox (available everywhere in Fedora and RHEL)
# we don't need the H.264 codec, and it is sometimes not available (rhbz#2005760)
dnf install --disablerepo=fedora-cisco-openh264 -y --setopt=install_weak_deps=False firefox

# nodejs 10 is too old for current Cockpit test API
if grep -q platform:el8 /etc/os-release; then
    dnf module switch-to -y nodejs:16
fi

# HACK: setroubleshoot-server crashes/times out randomly (breaking TestServices),
# and is hard to disable as it does not use systemd
if rpm -q setroubleshoot-server; then
    dnf remove -y --noautoremove setroubleshoot-server
fi

if grep -q 'ID=.*fedora' /etc/os-release && [ "$PLAN" = "basic" ]; then
    # Fedora-only packages which are not available in CentOS/RHEL
    # required by TestLogin.testBasic
    dnf install -y tcsh
    # required by TestJournal.testAbrt*
    dnf install -y abrt abrt-addon-ccpp reportd libreport-plugin-bugzilla libreport-fedora
fi

if grep -q 'ID=.*rhel' /etc/os-release; then
    # required by TestUpdates.testKpatch, but kpatch is only in RHEL
    dnf install -y kpatch kpatch-dnf
fi

# On CentOS Stream 8 the cockpit package is upgraded so the file isn't touched.
if [ ! -f /etc/cockpit/disallowed-users ]; then
    echo 'root' > /etc/cockpit/disallowed-users
fi

#HACK: unbreak RHEL 9's default choice of 999999999 rounds, see https://bugzilla.redhat.com/show_bug.cgi?id=1993919
sed -ie 's/#SHA_CRYPT_MAX_ROUNDS 5000/SHA_CRYPT_MAX_ROUNDS 5000/' /etc/login.defs

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
    curl https://raw.githubusercontent.com/cockpit-project/bots/main/machine/identity.pub  >> /root/.ssh/authorized_keys
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
su - -c "env TEST_BROWSER=firefox SOURCE=$SOURCE LOGS=$LOGS $MYDIR/run-test.sh $PLAN" runtest

RC=$(cat $LOGS/exitcode)
exit ${RC:-1}
