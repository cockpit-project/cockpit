# shellcheck shell=sh

set -eux

PLAN="$1"

cd "${SOURCE}"

. /run/host/usr/lib/os-release

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

# Chromium sometimes gets OOM killed on testing farm
export TEST_BROWSER=firefox

# We only have one VM and tests should take at most one hour. So run those tests which exercise external API
# (and thus are useful for reverse dependency testing and gating), and exclude those which test cockpit-internal
# functionality to upstream CI. We also need to leave out some which make too strict assumptions about the testbed.
TESTS=""
EXCLUDES=""
RC=0

# make it easy to check in logs
echo "TEST_ALLOW_JOURNAL_MESSAGES: ${TEST_ALLOW_JOURNAL_MESSAGES:-}"
echo "TEST_AUDIT_NO_SELINUX: ${TEST_AUDIT_NO_SELINUX:-}"

if [ "$PLAN" = "optional" ]; then
    TESTS="$TESTS
           TestAutoUpdates
           TestUpdates
           TestStorage
           "

    # Testing Farm machines often have pending restarts/reboot
    EXCLUDES="$EXCLUDES TestUpdates.testBasic TestUpdates.testFailServiceRestart TestUpdates.testKpatch"

    # FIXME: creation dialog hangs forever
    EXCLUDES="$EXCLUDES TestStorageISCSI.testISCSI"

    # These don't test more external APIs
    EXCLUDES="$EXCLUDES
              TestAutoUpdates.testBasic
              TestAutoUpdates.testPrivilegeChange

              TestStorageBtrfs.testNothingMounted

              TestStorageFormat.testAtBoot
              TestStorageFormat.testFormatCancel
              TestStorageFormat.testFormatTooSmall
              TestStorageFormat.testFormatTypes

              TestStorageHidden.testHiddenRaid
              TestStorageHidden.testHiddenSnap
              TestStorageHiddenLuks.test

              TestStorageMounting.testAtBoot
              TestStorageMounting.testBadOption
              TestStorageMounting.testFirstMount
              TestStorageMounting.testMounting
              TestStorageMounting.testMountingHelp
              TestStorageMounting.testNeverAuto
              TestStorageMountingLUKS.testEncryptedMountingHelp
              TestStorageMountingLUKS.testDuplicateMountPoints
              TestStorageMountingLUKS.testNeverAuto

              TestStorageIgnored.testIgnored
              TestStoragePackagesNFS.testNfsMissingPackages
              TestStoragePartitions.testSizeSlider
              TestStorageStratis.testAlerts
              TestStorageUnused.testUnused

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
              TestNetworkingUnmanaged.testUnmanaged
              "
fi


exclude_options=""
for t in $EXCLUDES; do
    exclude_options="$exclude_options --exclude $t"
done

GATEWAY="$(python3 -c 'import socket; print(socket.gethostbyname("_gateway"))')"
./test/common/run-tests \
    --test-dir test/verify \
    --nondestructive \
    --machine "${GATEWAY}":22 \
    --browser "${GATEWAY}":9090 \
    $exclude_options \
    $TESTS \
|| RC=$?

echo $RC > "$LOGS/exitcode"
cp --verbose Test* "$LOGS" || true
exit $RC
