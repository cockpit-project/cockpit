#!/bin/sh
set -eux

PLAN="$1"

cd "$SOURCE"

. /etc/os-release

# on Fedora we always test all packages;
# on RHEL/CentOS 8 we have a split package, only test basic bits for "cockpit" and optional bits for "c-appstream"
if [ "$PLATFORM_ID" = "platform:el8" ]; then
    if ls ../cockpit-appstream* 1> /dev/null 2>&1; then
        if [ "$PLAN" = "basic" ] || [ "$PLAN" = "network" ]; then
            echo "SKIP: not running basic/network tests for cockpit-appstream"
            echo 0 > "$LOGS/exitcode"
            exit 0
        fi
    else
        if [ "$PLAN" = "optional" ]; then
            echo "SKIP: not running optional tests for split RHEL 8 cockpit"
            echo 0 > "$LOGS/exitcode"
            exit 0
        fi
    fi
fi

# tests need cockpit's bots/ libraries
git clone --depth=1 https://github.com/cockpit-project/bots

# release tarballs include the necessary npm modules for testing
if [ -d .git ]; then
    ./tools/node-modules checkout
fi

export TEST_OS="${ID}-${VERSION_ID/./-}"

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

# HACK: https://github.com/systemd/systemd/issues/24150
if [ "$ID" = "fedora" ]; then
       TEST_ALLOW_JOURNAL_MESSAGES="${TEST_ALLOW_JOURNAL_MESSAGES},Journal file /var/log/journal/*/user-1000@*.journal corrupted, ignoring file .*"
fi

export TEST_ALLOW_JOURNAL_MESSAGES

# We only have one VM and tests should take at most one hour. So run those tests which exercise external API
# (and thus are useful for reverse dependency testing and gating), and exclude those which test cockpit-internal
# functionality to upstream CI. We also need to leave out some which make too strict assumptions about the testbed.
TESTS=""
EXCLUDES=""
RC=0
if [ "$PLAN" = "optional" ]; then
    TESTS="$TESTS
           TestAutoUpdates
           TestUpdates
           TestStorage
           "

    # Testing Farm machines often have pending restarts/reboot
    EXCLUDES="$EXCLUDES TestUpdates.testBasic TestUpdates.testFailServiceRestart TestUpdates.testKpatch"

    # These don't test more external APIs
    EXCLUDES="$EXCLUDES
              TestAutoUpdates.testBasic
              TestAutoUpdates.testPrivilegeChange

              TestStorageFormat.testAtBoot
              TestStorageFormat.testFormatCancel
              TestStorageFormat.testFormatTooSmall
              TestStorageFormat.testFormatTypes

              TestStoragePackagesNFS.testNfsMissingPackages
              TestStoragePartitions.testSizeSlider
              TestStorageIgnored.testIgnored

              TestUpdates.testUnprivileged
              TestUpdates.testPackageKitCrash
              TestUpdates.testNoPackageKit
              TestUpdates.testInfoTruncation
              "

    # RHEL test machines have a lot of junk mounted on /mnt
    if [ "${TEST_OS#rhel-}" != "$TEST_OS" ]; then
        EXCLUDES="$EXCLUDES
            TestStorageNfs.testNfsBusy
            TestStorageNfs.testNfsClient
            TestStorageNfs.testNfsMountWithoutDiscovery
            "
    fi
fi

if [ "$PLAN" = "basic" ]; then
    # Don't run TestPages, TestPackages, and TestTerminal at all -- not testing external APIs
    TESTS="$TESTS
        TestAccounts
        TestKdump
        TestJournal
        TestLogin
        TestServices
        TestSOS
        TestSystemInfo
        TestTuned
        "

    # PCI devices list is not predictable
    EXCLUDES="$EXCLUDES TestSystemInfo.testHardwareInfo"

    if [ "${TEST_OS#rhel-8}" != "$TEST_OS" ] || [ "${TEST_OS#centos-8}" != "$TEST_OS" ]; then
        # no cockpit-tests package in RHEL 8
        EXCLUDES="$EXCLUDES TestLogin.testSELinuxRestrictedUser"

        # fails to start second browser, timing out on http://127.0.0.1:{cdp_port}/json/list
        # impossible to debug without access to the infra
        EXCLUDES="$EXCLUDES TestAccounts.testUserPasswords"
    fi

    # These don't test more external APIs
    EXCLUDES="$EXCLUDES
              TestAccounts.testAccountLogs
              TestAccounts.testExpire
              TestAccounts.testRootLogin
              TestAccounts.testUnprivileged

              TestLogin.testConversation
              TestLogin.testExpired
              TestLogin.testFailingWebsocket
              TestLogin.testFailingWebsocketSafari
              TestLogin.testFailingWebsocketSafariNoCA
              TestLogin.testLogging
              TestLogin.testRaw
              TestLogin.testServer
              TestLogin.testUnsupportedBrowser

              TestSOS.testWithUrlRoot
              TestSOS.testCancel
              TestSOS.testAppStream

              TestSystemInfo.testInsightsStatus
              TestSystemInfo.testMotd
              TestSystemInfo.testShutdownStatus

              TestJournal.testAbrtDelete
              TestJournal.testAbrtReportNoReportd
              TestJournal.testAbrtReportCancel
              TestJournal.testBinary
              TestJournal.testNoMessage

              TestServices.testApi
              TestServices.testConditions
              TestServices.testHiddenFailure
              TestServices.testLogs
              TestServices.testLogsUser
              TestServices.testNotFound
              TestServices.testNotifyFailed
              TestServices.testRelationships
              TestServices.testRelationshipsUser
              TestServices.testResetFailed
              TestServices.testTransientUnits
              TestServices.testUnprivileged
              "
fi

if [ "$PLAN" = "network" ]; then
    TESTS="$TESTS
        TestBonding
        TestBridge
        TestFirewall
        TestNetworking
        TestTeam
        "

    # These don't test more external APIs
    EXCLUDES="$EXCLUDES
              TestBonding.testActive
              TestBonding.testAmbiguousMember
              TestBonding.testNonDefaultSettings

              TestFirewall.testAddCustomServices
              TestFirewall.testNetworkingPage

              TestNetworkingBasic.testIpHelper
              TestNetworkingBasic.testNoService
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
