# Integration Tests of Cockpit

This directory contains automated integration tests for Cockpit, and the
support files for them. The architecture of the automated integration tests is
described in [ARCHITECTURE](./ARCHITECTURE.md)

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

    test/image-prepare

This uses the default OS image, which is currently Fedora 38. See `$TEST_OS`
below how to select a different one.

In most cases you want to run an individual test in a suite, for example:

    test/verify/check-metrics TestCurrentMetrics.testCPU

You can get a list of tests by inspecting the `def test*` in the source, or by
running the suite with `-l`/`--list`:

    test/verify/check-metrics -l

Sometimes you may also want to run all tests in a test file suite:

    test/verify/check-session

To see more verbose output from the test, use the `-v`/`--verbose` and/or `-t`/`--trace` flags:

    test/verify/check-session --verbose --trace

If you specify `-s`/`--sit` in addition, then the test will wait on failure and
allow you to log into cockpit and/or the test instance and diagnose the issue.
The cockpit and SSH addresses of the test instance will be printed:

    test/verify/check-session -st

You can also run *all* the tests, with some parallelism:

    test/common/run-tests --test-dir test/verify --jobs 2

However, this will take *really* long. You can specify a subset of tests (see
`--help`); but usually it's better to run individual tests locally, and let the
CI machinery run all of them in a draft pull request.

The tests will automatically download the VM images they need, so expect
that the initial run may take a few minutes.

## Interactive browser

Normally each test starts its own chromium headless browser process on a
separate random port. To interactively follow what a test is doing:

    TEST_SHOW_BROWSER=1 test/verify/check-session --trace

You can also run a test against Firefox instead of Chromium:

    TEST_BROWSER=firefox test/verify/check-session --trace

See below for details.

## Manual testing

You can conduct manual interactive testing against a test image by starting the
image like so:

     bots/vm-run -s cockpit.socket debian-stable

Once the machine is booted and the cockpit socket has been activated, a
message will be printed describing how to access the virtual machine, via
ssh and web.  See the "Helpful tips" section below.

## Pixel tests

Pixel tests in Cockpit ensure that updates of our dependencies or code changes
don't break the UI: for example slight changes of layout, padding, color and
everything which isn't easily spotted by a human. They also give us confidence
that an update of our UI Framework doesn't introduce changes in how Cockpit
looks.

Pixel tests make a screenshot of a selector and compare it to a known good
reference image. if there is a difference, the test fails and a pixel
difference is shown.

This works as our tests run in the [cockpit/tasks container](https://quay.io/repository/cockpit/tasks)
which pins the browser and font rendering so repeated runs provide the same
pixels. To generate new pixels, this tasks container must be used; your own
browser and font rendering software might generate different results. For more
information read the ["introduction blog post"](https://cockpit-project.org/blog/pixel-testing.html).

The test images are stored in a git submodule in the `test/reference` directory
and be fetched with:

```sh
./test/common/pixel-tests update
```

As Cockpit tests under multiple distributions and it is not worth the effort to
run pixel tests on every supported distribution we only run them for the
image configured in `test/reference-image`.

Our tests call `Browser.assert_pixels` at interesting and strategic places.
This assertion method requires at least a CSS selector and an image title.
Pixel tests are generated in five layouts by default: desktop, medium, mobile,
dark and rtl.

Take a screenshot of the content in `#detail-content`:
```python
browser.assert_pixels("#detail-content", "filesystem")
```

Take a screenshot of the content in `#detail-content` and ignore all elements
with a class `disk-stats` as they change per test run:
```python
browser.assert_pixels("#detail-content", "filesystem", ignore=[".disks-stats"])
```

Take a screenshot of the content in `#detail-content` and skip it for a
specific layout as it generates unstable pixels:
```python
browser.assert_pixels("#detail-content", "filesystem", skip_layouts=["rtl"])
```

To update pixel tests, locally run the test in the current tasks container, or
create a draft PR and let the tests run for `test/reference-image` and
afterwards fetch the new pixels:

```
./test/common/pixel-tests fetch "https://cockpit-logs.us-east-1.linodeobjects.com/<snip>/log.html"
```

Finally, upload the new pixel tests and commit the newly generated submodule commit:
```
./test/common/pixel-tests push
```

**Note** that you have to a part of the [Contributors group](https://github.com/orgs/cockpit-project/teams/contributors)
to push pixel tests.

## Test Configuration

You can set these environment variables to configure the test suite:

    TEST_OS    The OS to run the tests in.  Currently supported values:
                  "centos-8-stream"
                  "debian-stable"
                  "debian-testing"
                  "fedora-38"
                  "fedora-39"
                  "fedora-coreos"
                  "fedora-testing"
                  "rhel-8-9"
                  "rhel-8-9-distropkg"
                  "rhel-9-3"
                  "rhel4edge",
                  "ubuntu-2204"
                  "ubuntu-stable"
               "fedora-38" is the default (TEST_OS_DEFAULT in bots/lib/constants.py)

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

## Convenient test VM SSH access

It is recommended to add a snippet like this to your `~/.ssh/config`. Then
you can log in to test machines without authentication:

    Match final host 127.0.0.2
        User root
        StrictHostKeyChecking no
        UserKnownHostsFile /dev/null
        CheckHostIp no
        IdentityFile CHECKOUT_DIR/bots/machine/identity
        IdentitiesOnly yes

You need to replace `CHECKOUT_DIR` with the actual directory where you cloned
`cockpit.git`, or `bots.git` if you have a separate clone for that.

Many cockpit developers take it a step further, and add an alias to
allow typing `ssh c`:

    Host c
        Hostname 127.0.0.2
        Port 2201

The `final` keyword in the first rule will cause it to be checked (and matched)
after the `Hostname` substitution in the `c` rule.

## Fast develop/test iteration

Each `image-prepare` invocation will always start from the pristine image and
ignore the current overlay in `test/images`. It is thorough, but also rather
slow. If you want to iterate on changing only JavaScript/HTML code, as opposed
to the bridge or webserver, the whole build and test cycle can be done much
faster.

You always need to do at least one initial `test/image-prepare $TEST_OS` run.
Afterwards it depends on the kind of test you want to run.

### Nondestructive tests

Many test methods or classes are marked as `@nondestructive`, meaning that
they restore the state of the test VM enough that other tests can run
afterwards. This is the fastest and most convenient situation for both
iterating on the code and debugging failing tests.

Start the prepared VM with `bots/vm-run $TEST_OS`. Note the SSH and cockpit
ports. If this is the only running VM, it will have the ports in the
examples below, otherwise the port will be different.

Then start building the page you are working on
[in watch and rsync mode](../HACKING.md#working-on-cockpits-session-pages), e.g.

    RSYNC=c ./build.js -w users

(Assuming the `c` SSH alias from the previous section and first running VM).

Then you can run a corresponding test against the running VM, with additional
debug output:

    TEST_OS=... test/verify/check-users -t --machine 127.0.0.2:2201 --browser 127.0.0.2:9091 TestAccounts.testBasic

### Destructive tests

Other tests need one or more fresh VMs. Instead of a full `test/image-prepare`
run (which is slow), you can update the existing VM overlay with updated
bundles. Start the build in watch mode, but without rsyncing, e.g.

    ./build.js -w storaged

and after each iteration, copy the new bundles into the VM overlay:

    bots/image-customize -u dist:/usr/share/cockpit/ $TEST_OS

Then run the test as you would normally do, e.g.

    TEST_OS=... test/verify/check-storage-stratis -t TestStorageStratis.testBasic

Use `bots/vm-reset` to clean up all prepared overlays in `test/images`.

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

## Coverage

Every pull request will trigger a `$DEFAULT_OS/devel` scenario which creates a
coverage report of the JavaScript code executed and writes comments about
uncovered code in the pull request. The overall coverage percentage is recorded
in prometheus for a subset of our projects and [visualized in Grafana](https://grafana-cockpit.apps.ocp.cloud.ci.centos.org/d/ci/cockpit-ci?orgId=1).

To generate coverage locally for `TestApps`:

```
export NODE_ENV=devel
./build.js
./test/image-prepare -q
./test/common/run-tests --test-dir test/verify --coverage TestApps
```

Code which is impossible or very hard to test in our tests can be excluded from
appearing in a pull request as comment by adding a `not-covered` comment with a
short justification:

```javascript
return cockpit.script(data, { superuser: "try", err: "message" })
              .catch(console.error); // not-covered: OS error
```

## Helpful tips

For web access, if you'd like to avoid Chromium (or Chrome) prompting
about certificate errors while connecting to localhost, you can change
the following setting:

    chrome://flags/#allow-insecure-localhost
