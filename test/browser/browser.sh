#!/bin/sh
# This script is meant to be run on an ephemeral CI host, for packit/Fedora/RHEL gating.
set -eux

# like "basic", passed on to run-test.sh
PLAN="$1"

export TEST_BROWSER=${TEST_BROWSER:-firefox}

MYDIR="$(realpath $(dirname "$0"))"
SOURCE="$(realpath $MYDIR/../..)"
# https://tmt.readthedocs.io/en/stable/overview.html#variables
LOGS="${TMT_TEST_DATA:-$(pwd)/logs}"
export SOURCE LOGS
mkdir -p "$LOGS"
chmod a+w "$LOGS"

# show some system info
nproc
free -h
rpm -qa | grep cockpit

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
    dnf remove -y --setopt=clean_requirements_on_remove=False setroubleshoot-server
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

# if we run during cross-project testing against our main-builds COPR, then let that win
# even if Fedora has a newer revision
main_builds_repo="$(ls /etc/yum.repos.d/*cockpit:main-builds* 2>/dev/null || true)"
if [ -n "$main_builds_repo" ]; then
    echo 'priority=0' >> "$main_builds_repo"
    dnf distro-sync -y 'cockpit*'
fi

# RHEL 8 does not build cockpit-tests; when dropping RHEL 8 support, move to test/browser/main.fmf
if [ "$PLAN" = basic ] && ! grep -q el8 /etc/os-release; then
    dnf install -y cockpit-tests
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
# once we drop support for RHEL 8, use this:
# runuser -u runtest --whitelist-environment=TEST_BROWSER,TEST_ALLOW_JOURNAL_MESSAGES,TEST_AUDIT_NO_SELINUX,SOURCE,LOGS "$MYDIR/run-test.sh" "$PLAN"
runuser -u runtest --preserve-environment env USER=runtest HOME="$(getent passwd runtest | cut -f6 -d:)" "$MYDIR/run-test.sh" "$PLAN"

RC=$(cat $LOGS/exitcode)
exit ${RC:-1}
