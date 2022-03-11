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
if [ "$TEST_OS" = "fedora-37" ]; then
    export TEST_OS=fedora-36
fi

if [ "${TEST_OS#centos-}" != "$TEST_OS" ]; then
    TEST_OS="${TEST_OS}-stream"
fi

if [ "$ID" = "fedora" ]; then
    # Testing Farm machines are really slow at some times of the day
    export TEST_TIMEOUT_FACTOR=3
fi

TEST_ALLOW_JOURNAL_MESSAGES=""

# HACK: CI hits this selinux denial. Unrelated to our tests.
TEST_ALLOW_JOURNAL_MESSAGES=".*Permission denied:.*/var/cache/app-info/xmls.*"

# HACK: occasional failure, annoyingly hard to debug
if [ "${TEST_OS#centos-8}" != "$TEST_OS" ]; then
    TEST_ALLOW_JOURNAL_MESSAGES="${TEST_ALLOW_JOURNAL_MESSAGES},couldn't create runtime dir: /run/user/1001: Permission denied"
fi

export TEST_ALLOW_JOURNAL_MESSAGES

# select tests
TESTS=""
EXCLUDES=""
RC=0
if [ -n "$test_optional" ]; then
    TESTS="$TESTS
         TestUpdates
         TestAutoUpdates
         TestStorage"

    # Testing Farm machines often have pending restarts/reboot
    EXCLUDES="$EXCLUDES TestUpdates.testBasic TestUpdates.testFailServiceRestart"
fi

if [ -n "$test_basic" ]; then
    # PCI devices list is not predictable
    EXCLUDES="$EXCLUDES TestSystemInfo.testHardwareInfo"

    # No ABRT in CentOS/RHEL, thus not a test dependency
    EXCLUDES="$EXCLUDES
              TestJournal.testAbrtDelete
              TestJournal.testAbrtReportCancel
              TestJournal.testAbrtReport
              TestJournal.testAbrtReportNoReportd
              TestJournal.testAbrtSegv"

    # FIXME: Often times out on at least c8s and f34 in TF
    EXCLUDES="$EXCLUDES TestPages.testHistory"

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

    # HACK: check-sos fails 100% on Testing Farm Fedora 36 without any error message; works in local tmt VM
    if [ "$TEST_OS" = "fedora-36" ]; then
        TESTS="${TESTS/TestSOS/}"
    fi

    # HACK: repeatedly fails on RHEL Testing Farm without error message, then corrupts VM
    if [ "$TEST_OS" = "rhel-9-0" ]; then
        EXCLUDES="$EXCLUDES TestPages.testBasic"
    fi
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
