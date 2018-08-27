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

    $ ./bots/image-prepare

To run the integration tests run the following (do NOT run the integration tests
as root):

    $ ./test/verify/run-tests

The tests will automatically download the VM images they need, so expect
that the initial run may take a couple of hours (there are quite a few
images to retrieve for different scenario tests).

Alternatively you can run an individual test like this:

    $ ./bots/image-prepare
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

## Details

The verify test suite is the main test suite:

 * `test/verify/run-tests`: Run all tests
 * `test/verify/check-*`: Run the selected tests

## Test Configuration

You can set these environment variables to configure the test suite:

    TEST_OS    The OS to run the tests in.  Currently supported values:
                  "centos-7"
                  "debian-stable"
                  "debian-testing"
                  "fedora-28"
                  "fedora-29"
                  "fedora-atomic"
                  "fedora-testing"
                  "rhel-7-5"
                  "rhel-7-5-distropkg"
                  "rhel-7-6"
                  "ubuntu-1604"
               "fedora-28" is the default (testvm.py)

    TEST_DATA  Where to find and store test machine images.  The
               default is the same directory that this README file is in.

    TEST_JOBS  How many tests to run in parallel.  The default is 1.

    TEST_CDP_PORT  Attach to an actually running browser that is compatible with
                   the Chrome Debug Protocol, on the given port. Don't use this
                   with parallel tests.

## Test machines and their images

The code under test is executed in one or more dedicated virtual
machines, called the "test machines".  Fresh test machines are started
for each test. To pull all the needed images for a given commit, use:

    $ bots/image-download

A test machine runs a "test machine image".  Such a test machine image
contains the root filesystem that is booted inside the virtual
machine.  A running test machine can write to its root filesystem, of
course, but these changes are (usually) not propagated back to its
image.  Thus, you can run multiple test machines from the same image,
at the same time or one after the other, and each test machine starts
with a clean state.

A test machine image is created with image-create, like so:

    $ bots/image-create -v fedora-atomic

The image will be created in `$TEST_DATA/images/`. In addition a link
reference will be created in `bots/images/`.

If you wish that others use this new image then you should commit the
new reference link, and use `image-upload` to upload the new image. You
would need to have Cockpit commit access to do this:

    $ bots/image-upload fedora-atomic

There is more than one test machine image. For example, you might
want to test a scenario where Cockpit on one machine talks to FreeIPA
on another, and you want those two machines to use different images.

This is handled by passing a specific image to image-create
and other scripts that work with test machine images.

    "fedora-NN" -- The basic image for running the development version of Cockpit.
                   This is the default.

    "fedora-stock" -- A stock installation of Fedora, including the stock
                      version of Cockpit.  This is used to test compatibility
                      between released versions of Cockpit and the development version.

    "ipa"       -- A FreeIPA server.

    "openshift" -- An Openshift Origin server.

A test machine image created by image-create doesn't contain any Cockpit
code in it yet.  You can build and install the currently checked out
working copy of Cockpit like this:

    $ bots/image-prepare

This either needs a configured/built tree (build in mock or a development VM)
or cockpit's build dependencies installed.

image-prepare will prepare a test machine image used for the next test run,
but will not modify the saved version in `$TEST_DATA/images`.  Use
vm-reset to revert the test machine images for the next run to the
versions in `$TEST_DATA/images`.

A typical sequence of steps would thus be the following:

    $ bots/image-download
    $ test/vm-reset            # Start over
    $ tools/make-rpms          # Create rpms
    $ bots/image-prepare ...   # Install code to test
    $ test/verify/check-...    # Run some tests

    $ test/vm-reset            # Start over
    $ bots/image-prepare ...   # Install code to test
    $ test/verify/check-...    # Run some tests

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

The third class of integration tests use avocado and selenium to cover
different browsers:

    $ bots/image-download selenium
    $ bots/image-prepare fedora-28
    $ TEST_OS=fedora-28 test/avocado/run-tests --selenium-tests --browser=firefox -v

Currently, these tests run on Fedora 28. Other images don't have selenium and
avocado installed.

## Debugging tests

If you pass the `-s` ("sit on failure") option to a test program, it
will pause when a failure occurs so that you can log into the test
machine and investigate the problem.

A test will print out the commands to access it when it fails in this
way. You can log into a running test-machine using ssh. If you add
a snippet like this to your `~/.ssh/config` then you'll be able to
log in without authentication:

    Host 127.0.0.2
        User root
        StrictHostKeyChecking no
        UserKnownHostsFile /dev/null
        IdentityFile ~/src/cockpit/bots/machine/identity

You can also put calls to `sit()` into the tests themselves to stop them
at strategic places.

That way, you can run a test cleanly while still being able to make
quick changes, such as adding debugging output to JavaScript.

## Guidelines for writing tests

It is OK for a test to destroy the test machine OS installation, or
otherwise modify it without cleaning up.  For example, it is OK to
remove all of `/etc` just to see what happens.  The next test will get a
pristine test machine.

A fast running test suite is more important than independent,
small test cases.

Thus, it is OK for tests to be long.  Starting the test machine is so
slow that we should run as many checks within a single session as make
sense.

Still, within a long test, try to have independent sections, where
each section returns the machine to more or less the state that it was
in before the section.  This makes it easier to run these sections
ad-hoc when doing incremental development.
