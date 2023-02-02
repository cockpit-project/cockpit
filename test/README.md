# Integration Tests of Cockpit

This directory contains automated integration tests for Cockpit, and the support
files for them.

To run the tests on Fedora, refer to the [HACKING](../HACKING.md) guide for
installation of all of the necessary build and test dependencies. There's
no need to trigger a build manually - the test suite preparation step below
will handle that.

If test failures are encountered that look like they may be related to problems
with nested virtualization, refer to
[this Fedora guide](https://docs.fedoraproject.org/en-US/quick-docs/using-nested-virtualization-in-kvm/index.html)
for more details and recommendations on ensuring it is enabled correctly.

## Preparation and general invocation

*Warning*: Never run the build, test, or any other command here as root!

You first need to build cockpit, and install it into a VM:

    $ test/image-prepare

This uses the default OS image, which is currently Fedora 37. See `$TEST_OS`
below how to select a different one.

In most cases you want to run an individual test in a suite, for example:

    $ test/verify/check-metrics TestCurrentMetrics.testCPU

You can get a list of tests by inspecting the `def test*` in the source, or by
running the suite with `-l`/`--list`:

    $ test/verify/check-metrics -l

Sometimes you may also want to run all tests in a test file suite:

    $ test/verify/check-session

To see more verbose output from the test, use the `-v`/`--verbose` and/or `-t`/`--trace` flags:

    $ test/verify/check-session --verbose --trace

If you specify `-s`/`--sit` in addition, then the test will wait on failure and
allow you to log into cockpit and/or the test instance and diagnose the issue.
The cockpit and SSH addresses of the test instance will be printed:

    $ test/verify/check-session -st

You can also run *all* the tests, with some parallelism:

    $ test/common/run-tests --test-dir test/verify --jobs 2

However, this will take *really* long. You can specify a subset of tests (see
`--help`); but usually it's better to run individual tests locally, and let the
CI machinery run all of them in a draft pull request.

The tests will automatically download the VM images they need, so expect
that the initial run may take a few minutes.

## Interactive browser

Normally each test starts its own chromium headless browser process on a
separate random port. To interactively follow what a test is doing:

    $ TEST_SHOW_BROWSER=1 test/verify/check-session --trace

You can also run a test against Firefox instead of Chromium:

    $ TEST_BROWSER=firefox test/verify/check-session --trace

See below for details.

## Manual testing

You can conduct manual interactive testing against a test image by starting the
image like so:

     $ bots/vm-run -s cockpit.socket debian-stable

Once the machine is booted and the cockpit socket has been activated, a
message will be printed describing how to access the virtual machine, via
ssh and web.  See the "Helpful tips" section below.

## Pixel tests

The verify test suite contains ["pixel tests"](https://cockpit-project.org/blog/pixel-testing.html).
Make sure to create the test/reference submodule before running tests which contain pixel tests.

 * test/common/pixel-tests pull

## Test Configuration

You can set these environment variables to configure the test suite:

    TEST_OS    The OS to run the tests in.  Currently supported values:
                  "centos-8-stream"
                  "debian-stable"
                  "debian-testing"
                  "fedora-36"
                  "fedora-37"
                  "fedora-coreos"
                  "fedora-testing"
                  "rhel-8-7"
                  "rhel-8-7-distropkg"
                  "rhel-9-1"
                  "rhel4edge",
                  "ubuntu-2204"
                  "ubuntu-stable"
               "fedora-37" is the default (TEST_OS_DEFAULT in bots/lib/constants.py)

    TEST_JOBS  How many tests to run in parallel.  The default is 1.

    TEST_CDP_PORT  Attach to an actually running browser that is compatible with
                   the Chrome Debug Protocol, on the given port. Don't use this
                   with parallel tests.

    TEST_BROWSER  What browser should be used for testing. Currently supported values:
                     "chromium"
                     "firefox"
                  "chromium" is the default.

    TEST_SHOW_BROWSER  Set to run browser interactively. When not specified,
                       browser is run in headless mode. When set to "pixels",
                       the browser will be resized to the exact dimensions that
                       are used for pixel tests.

    TEST_TIMEOUT_FACTOR Scale normal timeouts by given integer. Useful for
                        slow/busy testbeds or architectures.

See the [bots documentation](https://github.com/cockpit-project/bots/blob/main/README.md)
for details about the tools and configuration for these.

## Faster iteration

Each `image-prepare` invocation will always start from the pristine image and
ignore the current overlay in `test/images`. It is thorough, but also rather
slow. If you want to iterate on changing only JavaScript/HTML code, you can use
this shortcut to copy updated webpacks into a prepared VM overlay image:

    $ make && bots/image-customize -u dist:/usr/share/cockpit/ $TEST_OS

Use `bots/vm-reset` to clean up all prepared overlays in `test/images`.

Many of the verify tests can also be run against an already running
machine. Although be aware that lots of the tests change state on
the target machine -- so only do this with the ones marked with
`@nondestructive`.

    $ test/verify/check-connection --machine=10.1.1.2 --browser 10.1.1.2:9090

In particular, you can use our standard test VMs with this mode:

    $ test/image-prepare
    $ bots/vm-run fedora-37

Note the SSH and cockpit ports. If this is the only running VM, it will have
the addresses in the example below, otherwise the port will be different.

Now you can change the code (see [HACKING.md](../HACKING.md) for webpack watch
mode), copy it into the VM, and run the test against it:

    $ test/verify/check-connection --machine 127.0.0.2:2201 --browser 127.0.0.2:9091

## Debugging tests

If you pass the `-s` ("sit on failure") option to a test program, it
will pause when a failure occurs so that you can log into the test
machine and investigate the problem.

A test will print out the commands to access it when it fails in this
way. You can log into a running test-machine using ssh.  See the
"Helpful tips" section below.

You can also put calls to `sit()` into the tests themselves to stop them
at strategic places.

That way, you can run a test cleanly while still being able to make
quick changes, such as adding debugging output to JavaScript.

## Guidelines for writing tests

If a test is not decorated with `@nondestructive`, it is OK for a test to
destroy the test machine OS installation, or otherwise modify it without
cleaning up.  For example, it is OK to remove all of `/etc` just to see what
happens.  The next test will get a pristine test machine.

Tests decorated with `@nondestructive` will all run against the same test
machine. The nondestructive test should clean up after itself and restore the
state of the machine, such that the next nondestructive test is not impacted.

A fast running test suite is more important than independent,
small test cases.

Thus, it is OK for tests to be long.  Starting the test machine is so slow that
we should run as many checks within a single session as make sense. Note that
nondestructive tests do not suffer from this, and are much quicker.

Still, within a long test, try to have independent sections, where
each section returns the machine to more or less the state that it was
in before the section.  This makes it easier to run these sections
ad-hoc when doing incremental development.

## Helpful tips

If you add a snippet like this to your `~/.ssh/config` then you'll be able to
log in to test machines without authentication:

    Match final host 127.0.0.2
        User root
        StrictHostKeyChecking no
        UserKnownHostsFile /dev/null
        CheckHostIp no
        IdentityFile ~/src/cockpit/bots/machine/identity
        IdentitiesOnly yes

Many cockpit developers take it a step further, and add an alias to
allow typing `ssh c`:

    Host c
        Hostname 127.0.0.2
        Port 2201

The `final` keyword in the first rule will cause it to be checked (and matched)
after the `Hostname` substitution in the `c` rule.

For web access, if you'd like to avoid Chromium (or Chrome) prompting
about certificate errors while connecting to localhost, you can change
the following setting:

    chrome://flags/#allow-insecure-localhost
