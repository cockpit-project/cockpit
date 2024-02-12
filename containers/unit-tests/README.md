# Cockpit unit test container

This container has all build dependencies and toolchains (GCC and clang) that we
want to exercise Cockpit with, mostly for `make distcheck` and `make check-memory`.
This container runs on [GitHub](.github/workflows/unit-tests.yml), but can be easily
run locally too.

It assumes that the Cockpit source git checkout is available in `/source`. It
will not modify that directory or take uncommitted changes into account, but it
will re-use an already existing `node_modules/` directory.

The scripts can use either podman (preferred) or docker. If you use docker, you
need to run all commands as root. With podman the containers work as either user
or root.

## Building

The `build` script will build the `cockpit/unit-tests` container.

## Running tests

You need to disable SELinux with `sudo setenforce 0` for this. There is no
other way for the container to access the files in your build tree (do *not*
use the `--volume` `:Z` option, as that will destroy the file labels on the
host).

Tests in that container get started with the `start` script.  By default, this
script runs the unit tests on amd64.  The script accepts a number of arguments
to modify its behaviour:

 - `--env CC=othercc` to set the `CC` environment variable inside the container (ie:
   to build with a different compiler)
 - `--image-tag` to specify a different tag to use for the `cockpit/unit-tests` image

Additionally, a testing scenario can be provided with specifying a `make` target.
Supported scenarios are:

 - `check-memory`: runs 'make check-memory' (ie: run the unit tests under valgrind)
 - `distcheck`: runs 'make distcheck' and some related checks
 - `pycheck`: runs browser unit tests against the Python bridge

Some examples:

    $ ./start --make check-memory                 # run the valgrind tests on amd64

    $ ./start --env=CC=clang --make check-memory  # run the valgrind tests, compiled with clang

## Debugging tests

For interactive debugging, run a shell in the container:

    $ ./start

You will find the cockpit source tree (from the host) mounted at `/source` in
the container. Run

    $ /source/autogen.sh

to create a build tree, then you can run any make or other debugging command
interactively.

You can also attach to another container using the provided `exec` script.  For example:

    $ ./exec uname -a   # run a command as the "builder" user

    $ ./exec --root     # start a shell as root

## More Info

 * [Cockpit Project](https://cockpit-project.org)
 * [Cockpit Development](https://github.com/cockpit-project/cockpit)
