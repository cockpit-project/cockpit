#!/bin/sh

set -eux

cd "${0%/*}/../.."

# like "storage-basic", passed on to run-test.sh
PLAN="$1"

# show some system info
nproc
free -h
rpm -qa | grep cockpit

# allow test to set up things on the machine
mkdir -p /root/.ssh
curl https://raw.githubusercontent.com/cockpit-project/bots/main/machine/identity.pub >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys

# HACK: setroubleshoot-server crashes/times out randomly (breaking TestServices),
# and is hard to disable as it does not use systemd
if rpm -q setroubleshoot-server; then
    dnf remove -y --setopt=clean_requirements_on_remove=False setroubleshoot-server
fi

# HACK: this package creates bogus/broken sda → nvme symlinks; it's new in rawhide TF default instances, not required for
# our tests, and only causes trouble; https://github.com/amazonlinux/amazon-ec2-utils/issues/37
if rpm -q amazon-ec2-utils; then
    rpm -e --verbose amazon-ec2-utils
    # clean up the symlinks, if they exist
    udevadm trigger /dev/nvme* || true
fi

if grep -q 'ID=.*fedora' /etc/os-release && [ "$PLAN" = "main" ]; then
    # Fedora-only packages which are not available in CentOS/RHEL
    # required by TestLogin.testBasic
    dnf install -y tcsh
    # required by TestTeam
    dnf install -y NetworkManager-team
fi

if grep -q 'ID=.*fedora' /etc/os-release && [ "$PLAN" = "storage-basic" ]; then
    # required by TestStorageBtrfs*
    dnf install -y udisks2-btrfs
    # required by TestStorageStratis
    dnf install -y stratisd-tools
fi

if grep -q 'ID=.*centos' /etc/os-release && grep -q 'VERSION_ID=.*10' /etc/os-release && [ "$PLAN" = "storage-basic" ]; then
    # required by TestStorageStratis
    dnf install -y stratisd-tools
fi

# dnf installs "missing" weak dependencies, but we don't want them for plans other than "main"
if [ "$PLAN" != "main" ] && rpm -q cockpit-packagekit; then
    dnf remove -y cockpit-packagekit
fi

if grep -q 'ID=.*rhel' /etc/os-release; then
    # required by TestUpdates.testKpatch, but kpatch is only in RHEL
    dnf install -y kpatch kpatch-dnf
fi

# HACK: RHEL has these bundled in cockpit-system, but Fedora doesn't; Provides: break in CentOS/RHEL 10
# due to https://issues.redhat.com/browse/TFT-2564
if ! grep -q platform:el /etc/os-release; then
    if [ "$PLAN" = "main" ]; then
        dnf install -y cockpit-kdump cockpit-networkmanager cockpit-sosreport
    fi
fi

# if we run during cross-project testing against our main-builds COPR, then let that win
# even if Fedora has a newer revision
main_builds_repo="$(ls /etc/yum.repos.d/*cockpit*main-builds* 2>/dev/null || true)"
if [ -n "$main_builds_repo" ]; then
    echo 'priority=0' >> "$main_builds_repo"
    dnf distro-sync -y 'cockpit*'
fi

#HACK: unbreak RHEL 9's default choice of 999999999 rounds, see https://bugzilla.redhat.com/show_bug.cgi?id=1993919
sed -ie 's/#SHA_CRYPT_MAX_ROUNDS 5000/SHA_CRYPT_MAX_ROUNDS 5000/' /etc/login.defs

# make libpwquality less aggressive, so that our "foobar" password works
printf 'dictcheck = 0\nminlen = 6\n' >> /etc/security/pwquality.conf

# set root's password
echo root:foobar | chpasswd

# create user account for logging in
if ! id admin 2>/dev/null; then
    useradd -c Administrator -G wheel admin
    echo admin:foobar | chpasswd
fi

# disable core dumps, we rather investigate them upstream where test VMs are accessible
echo core > /proc/sys/kernel/core_pattern

# make sure that we can access cockpit through the firewall
systemctl start firewalld
firewall-cmd --add-service=cockpit --permanent
firewall-cmd --add-service=cockpit

# HACK: https://bugzilla.redhat.com/show_bug.cgi?id=2273078
if grep -q platform:el10 /etc/os-release; then
    export NETAVARK_FW=nftables
fi

# Run tests in the cockpit tasks container, as unprivileged user
CONTAINER="$(cat .cockpit-ci/container)"
exec podman \
    run \
        --rm \
        --shm-size=1024m \
        --security-opt=label=disable \
        --env='TEST_*' \
        --volume="${TMT_TEST_DATA}":/logs:rw,U --env=LOGS=/logs \
        --volume="$(pwd)":/source:rw,U --env=SOURCE=/source \
        --volume=/usr/lib/os-release:/run/host/usr/lib/os-release:ro \
        "${CONTAINER}" \
            sh /source/test/browser/run-test.sh "$@"
