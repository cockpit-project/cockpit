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

export TEST_OS="${ID}-${VERSION_ID/./-}"
# HACK: upstream does not yet know about rawhide
if [ "$TEST_OS" = "fedora-36" ]; then
    export TEST_OS=fedora-35
fi

if [ "${TEST_OS#centos-}" != "$TEST_OS" ]; then
    TEST_OS="${TEST_OS}-stream"
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
    TESTS="$TESTS
         TestUpdates
         TestAutoUpdates
         TestStorage"
fi

if [ -n "$test_basic" ]; then
    # Testing Farm machines often have pending restarts/reboot
    EXCLUDES="$EXCLUDES TestUpdates.testBasic"

    # PCI devices list is not predictable
    EXCLUDES="$EXCLUDES TestSystemInfo.testHardwareInfo"

    # No ABRT in CentOS/RHEL, thus not a test dependency
    EXCLUDES="$EXCLUDES
              TestJournal.testAbrtDelete
              TestJournal.testAbrtReportCancel
              TestJournal.testAbrtReport
              TestJournal.testAbrtReportNoReportd
              TestJournal.testAbrtSegv"

    TESTS="$TESTS
        TestAccounts
        TestBonding
        TestBridge
        TestFirewall
        TestKdump
        TestJournal
        TestLogin
        TestNetworking
        TestPackages
        TestPages
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
