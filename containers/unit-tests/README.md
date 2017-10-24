# Cockpit unit test container

This container has all build dependencies and toolchains (GCC and clang) that
we want to exercise Cockpit with, mostly for `make distcheck` and `make
check-memory`. This container gets run in semaphore, but can be easily run
locally too.

It assumes that the Cockpit source git checkout is available in `/source`. It
will not modify that directory or take uncommitted changes into account, but it
will re-use an already existing `node_modules/` directory.

## Building

In a built cockpit tree you can run

    $ make unit-tests-container

which will build the `cockpit/unit-tests` and `cockpit/unit-tests:i386`
containers.

## Running tests

Tests in that container for the default configuration get started with

    $ make unit-tests-container-run

or equivalently with

    $ sudo docker run -ti --volume `pwd`:/source:ro cockpit/unit-tests

You can pass `--env=CC=clang` to build with Clang instead of gcc, or run
`cockpit/unit-tests:i386` to run on a 32 bit architecture.

## Debugging tests

For interactive debugging, run a shell in the container:

    $ make unit-tests-container-shell

or start the container with `bash` as the entry point. `./run.sh` will start
the builds and test run, then you can investigate in the build tree at
`/tmp/source/`.

## More Info

 * [Cockpit Project](https://cockpit-project.org)
 * [Cockpit Development](https://github.com/cockpit-project/cockpit)
