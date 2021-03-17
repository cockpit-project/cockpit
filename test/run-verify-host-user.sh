#!/bin/sh
set -eux

cd "$SOURCE"

. /etc/os-release
test_optional=
test_basic=

if ls ../cockpit-appstream* 1> /dev/null 2>&1; then
    test_optional=1
else
    test_basic=1
fi

if [ "$ID" = "fedora" ]; then
    test_basic=1
    test_optional=1
fi

# tests need cockpit's bots/ libraries
git clone --depth=1 https://github.com/cockpit-project/bots

# support running from clean git tree
if [ ! -d node_modules/chrome-remote-interface ]; then
    npm install chrome-remote-interface sizzle
fi

# disable detection of affected tests; testing takes too long as there is no parallelization,
# and TF machines are slow and brittle
mv .git dot-git

export TEST_OS="${ID}-${VERSION_ID/./-}"
# HACK: upstream does not yet know about rawhide
if [ "$TEST_OS" = "fedora-35" ]; then
    export TEST_OS=fedora-34
fi

if [ "$ID" = "fedora" ]; then
    # Testing Farm machines are really slow at some times of the day
    export TEST_TIMEOUT_FACTOR=3
fi

# HACK: CI hits this selinux denial. Unrelated to our tests.
export TEST_ALLOW_JOURNAL_MESSAGES=".*Permission denied:.*/var/cache/app-info/xmls.*"

# select tests
TESTS=""
EXCLUDES=""
RC=0
if [ -n "$test_optional" ]; then
    # pre-download cirros image for Machines tests
    bots/image-download cirros

    # triggers SELinux violation
    # See journal: SELinux is preventing /usr/libexec/qemu-kvm from open access on the file /var/lib/cockpittest/nfs_pool/nfs-volume-0.
    EXCLUDES="$EXCLUDES TestMachinesDisks.testAddDiskNFS"
    # not investigated yet
    EXCLUDES="$EXCLUDES
        TestAutoUpdates.testPrivilegeChange"

    # TestUpdates: we can't run rebooting tests
    TESTS="$TESTS
         TestAutoUpdates
         TestStorage
         TestUpdates.testBasic
         TestUpdates.testSecurityOnly"

    # Fedora gating tests are running on infra without /dev/kvm; Machines tests are too darn slow there
    if [ "$ID" = "fedora" ]; then
        TESTS="$TESTS TestMachinesCreate.testCreateImportDisk"
    else
        TESTS="$TESTS TestMachines"
    fi
fi

if [ -n "$test_basic" ]; then
    # TODO: fix for CI environment
    EXCLUDES="$EXCLUDES TestAccounts.testBasic"
    EXCLUDES="$EXCLUDES TestLogin.testServer"

    # Testing Farm machines often have pending restarts/reboot
    EXCLUDES="$EXCLUDES TestUpdates.testBasic"

    # PCI devices list is not predictable
    EXCLUDES="$EXCLUDES TestSystemInfo.testHardwareInfo"

    TESTS="$TESTS
        TestAccounts
        TestBonding
        TestBridge
        TestFirewall
        TestKdump
        TestLogin
        TestNetworking
        TestServices
        TestSOS
        TestSystemInfo
        TestTeam
        TestTerminal
        TestTuned
        "
fi

exclude_options=""
for t in $EXCLUDES; do
    exclude_options="$exclude_options --exclude $t"
done

# execute run-tests
test/common/run-tests --test-dir test/verify --nondestructive $exclude_options \
    --machine localhost:22 --browser localhost:9090 $TESTS || RC=$?

echo $RC > "$LOGS/exitcode"
cp --verbose Test* "$LOGS" || true
# deliver test result via exitcode file
exit 0
