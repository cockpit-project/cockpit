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

# support running from clean git tree; this doesn't work from release tarballs
if [ ! -d node_modules/chrome-remote-interface ] && [ -d . git ]; then
    ./tools/node-modules checkout
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

# We only have one VM and tests should take at most one hour. So run those tests which exercise external API
# (and thus are useful for reverse dependency testing and gating), and exclude those which test cockpit-internal
# functionality to upstream CI. We also need to leave out some which make too strict assumptions about the testbed.
TESTS=""
EXCLUDES=""
RC=0
if [ -n "$test_optional" ]; then
    TESTS="$TESTS
           TestAutoUpdates
           TestUpdates
           TestStorage
           "

    # Testing Farm machines often have pending restarts/reboot
    EXCLUDES="$EXCLUDES TestUpdates.testBasic TestUpdates.testFailServiceRestart"

    # These don't test more external APIs
    EXCLUDES="$EXCLUDES
              TestAutoUpdates.testBasic
              TestAutoUpdates.testPrivilegeChange

              TestUpdates.testUnprivileged
              TestUpdates.testPackageKitCrash
              TestUpdates.testNoPackageKit
              TestUpdates.testInfoTruncation
              "
fi

if [ -n "$test_basic" ]; then
    # Don't run TestPages, TestPackages, and TestTerminal at all -- not testing external APIs
    TESTS="$TESTS
        TestAccounts
        TestBonding
        TestBridge
        TestFirewall
        TestKdump
        TestJournal
        TestLogin
        TestNetworking
        TestServices
        TestSOS
        TestSystemInfo
        TestTeam
        TestTuned
        "

    # PCI devices list is not predictable
    EXCLUDES="$EXCLUDES TestSystemInfo.testHardwareInfo"

    # No ABRT in CentOS/RHEL, thus not a test dependency
    EXCLUDES="$EXCLUDES
              TestJournal.testAbrtDelete
              TestJournal.testAbrtReportCancel
              TestJournal.testAbrtReport
              TestJournal.testAbrtReportNoReportd
              TestJournal.testAbrtSegv
              "

    # These don't test more external APIs
    EXCLUDES="$EXCLUDES
              TestAccounts.testAccountLogs
              TestAccounts.testExpire
              TestAccounts.testRootLogin
              TestAccounts.testUnprivileged

              TestBonding.testActive
              TestBonding.testAmbiguousMember
              TestBonding.testNonDefaultSettings

              TestFirewall.testAddCustomServices
              TestFirewall.testNetworkingPage

              TestNetworkingBasic.testNoService

              TestLogin.testConversation
              TestLogin.testExpired
              TestLogin.testFailingWebsocket
              TestLogin.testFailingWebsocketSafari
              TestLogin.testFailingWebsocketSafariNoCA
              TestLogin.testLogging
              TestLogin.testRaw
              TestLogin.testServer
              TestLogin.testUnsupportedBrowser

              TestStoragePackagesNFS.testNfsMissingPackages
              TestStoragePartitions.testSizeSlider
              TestStorageIgnored.testIgnored

              TestSOS.testWithUrlRoot
              TestSOS.testCancel
              TestSOS.testAppStream

              TestSystemInfo.testMotd
              TestSystemInfo.testShutdownStatus

              TestJournal.testBinary
              TestJournal.testNoMessage

              TestServices.testApi
              TestServices.testConditions
              TestServices.testHiddenFailure
              TestServices.testLogs
              TestServices.testNotFound
              TestServices.testNotifyFailed
              TestServices.testRelationships
              TestServices.testRelationshipsUser
              TestServices.testResetFailed
              TestServices.testTransientUnits
              "

    # HACK: https://bugzilla.redhat.com/show_bug.cgi?id=2058142
    if [ "$TEST_OS" = "fedora-36" ]; then
        EXCLUDES="$EXCLUDES TestSOS.testBasic"
    fi

    # Firefox 91 (currently in centos-8-stream and centos-9-stream)
    # can't download files ending in ".gpg".
    if rpmquery firefox | grep -q ^firefox-91; then
        EXCLUDES="$EXCLUDES TestSOS.testBasic"
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
