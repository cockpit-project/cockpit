# Integration Tests of Cockpit

This directory contains automated integration tests for Cockpit, and the support
files for them.

To run the tests on Fedora, refer to the [HACKING](../HACKING.md) guide for
installation of all of the necessary build and test dependencies. There's
no need to trigger a build manually - the test suite preparation step below
will handle that.

If test failures are encountered that look like they may be related to problems
with nested virtualization, refer to
[this Fedora guide](https://fedoraproject.org/wiki/How_to_enable_nested_virtualization_in_KVM)
for more details and recommendations on ensuring it is enabled correctly.

## Introduction

Before running the tests, ensure Cockpit has been built where the test suite
expects to find it (do NOT run the build step as root):

    $ ./test/image-prepare

To run the integration tests run the following (do NOT run the integration tests
as root):

    $ ./test/verify/run-tests

The tests will automatically download the VM images they need, so expect
that the initial run may take a couple of hours (there are quite a few
images to retrieve for different scenario tests).

Alternatively you can run an individual test like this:

    $ ./test/image-prepare
    $ ./test/verify/check-session

To see more verbose output from the test, use the `--verbose` and/or `--trace` flags:

    $ ./test/verify/check-session --verbose --trace

In addition if you specify `--sit`, then the test will wait on failure and allow
you to log into cockpit and/or the test instance and diagnose the issue. An address
will be printed of the test instance.

    $ ./test/verify/check-session --trace --sit

Normally each test starts its own chromium headless browser process on a
separate random port. To interactively follow what a test is doing, start the
browser manually and tell the test which debug port it should attach to:

    $ chromium-browser --remote-debugging-port=9222 about:blank
    $ TEST_CDP_PORT=9222 ./test/verify/check-session --trace

Finally, you can conduct manual testing against a test image by starting the
image like so:

     $ bots/vm-run -s cockpit.socket debian-stable

Once the machine is booted and the cockpit socket has been activated, a
message will be printed describing how to access the virtual machine, via
ssh and web.  See the "Helpful tips" section below.

## Details

The verify test suite is the main test suite:

 * `test/verify/run-tests`: Run all tests
 * `test/verify/check-*`: Run the selected tests

## Test Configuration

You can set these environment variables to configure the test suite:

    TEST_OS    The OS to run the tests in.  Currently supported values:
                  "centos-8-stream"
                  "debian-stable"
                  "debian-testing"
                  "fedora-31"
                  "fedora-32"
                  "fedora-33"
                  "fedora-coreos"
                  "fedora-testing"
                  "rhel-7-9"
                  "rhel-8-3"
                  "rhel-8-3-distropkg"
                  "ubuntu-2004"
                  "ubuntu-stable"
               "fedora-31" is the default (bots/machine/machine_core/constants.py)

    TEST_JOBS  How many tests to run in parallel.  The default is 1.

    TEST_CDP_PORT  Attach to an actually running browser that is compatible with
                   the Chrome Debug Protocol, on the given port. Don't use this
                   with parallel tests.

    TEST_BROWSER  What browser should be used for testing. Currently supported values:
                     "chromium"
                     "firefox"
                  "chromium" is the default.

    TEST_SHOW_BROWSER  Set to run browser interactively. When not specified,
                       browser is run in headless mode.

## Test machines and their images

The code under test is executed in one or more dedicated virtual
machines, called the "test machines".  Fresh test machines are started
for each test. See the
[bots documentation](https://github.com/cockpit-project/bots/blob/master/README.md)
for details about the tools and configuration for these.

These test machine images don't contain any Cockpit code yet.  You can build
and install the currently checked out working copy of Cockpit like this:

    $ test/image-prepare

This either needs a configured/built tree (build in mock or a development VM)
or cockpit's build dependencies installed.

image-prepare will prepare a test machine image used for the next test run. It
will not modify the original image, but do all the preparation in an overlay in
`test/images`.

A typical sequence of steps would thus be the following:

    $ make                     # Build the code
    $ test/image-prepare ...   # Install code to test
    $ test/verify/check-...    # Run some tests

Each image-prepare invocation will always start from the pristine image and
ignore the current overlay in `test/images`. It is thorough, but also rather
slow. If you want to iterate on changing only JavaScript/HTML code, you can use
this shortcut to copy updated webpacks into a prepared VM overlay image:

    $ make && bots/image-customize -u dist:/usr/share/cockpit/ $TEST_OS

Use `test/vm-reset` to clean up all prepared overlays in `test/images`.

## Running tests

Once you have a test machine image that contains the version of
Cockpit that you want to test, you can run tests by picking a program
and just executing it:

    $ test/verify/check-connection

Many of the verify tests can also be run against an already running
machine. Although be aware that lots of the tests change state on
the target machine.

    $ test/verify/check-connection --machine=10.1.1.2

The `test/containers/` tests use the same VMs as the above `test/verify/` ones.
But they don't have a separate "prepare" step/script; instead, the first time
you run `test/containers/run-tests` you need to use the `-i` option to
build/install cockpit into the test VM. This needs to be done with a compatible
`TEST_OS` (usually a recent `fedora-*`).

### Selenium tests
The third class of integration tests use avocado and selenium to cover
different browsers.

For more details on how to run and debug these tests see [selenium hacking guide](./selenium/README.md)


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

    Host 127.0.0.2
        User root
        Port 2201
        StrictHostKeyChecking no
        UserKnownHostsFile /dev/null
        IdentityFile ~/src/cockpit/bots/machine/identity

Many cockpit developers take it a step further, and add an alias to
allow typing `ssh c`:

    Host 127.0.0.2 c
        Hostname 127.0.0.2
        User root
        ... etc

For web access, if you'd like to avoid Chromium (or Chrome) prompting
about certificate errors while connecting to localhost, you can change
the following setting:

    chrome://flags/#allow-insecure-localhost
