# Hacking on Cockpit

Start by getting the code:

    git clone https://github.com/cockpit-project/cockpit
    cd cockpit/

The remainder of the commands assume you're in the top level of the
Cockpit git repository checkout.

**Do not clone a fork!** This will not work for various reasons (missing tags,
determining version, integration with bots commands). Please keep `origin` as
the read-only actual upstream project, and add your fork as a separate writable
remote, for example with

    git remote add my git@github.com:yourgithubid/cockpit.git

## Setting up development container

The cockpit team maintains a [cockpit/tasks container](https://ghcr.io/cockpit-project/tasks)
for both local development and CI. If you can install [toolbx](https://containertoolbx.org/) or
[distrobox](https://distrobox.privatedns.org/) on your system, it is highly
recommended to do that:

 - It is *the* official environment for CI, known to work, and gives you reproducible results.
 - It avoids having to install development packages on your main machine.
 - It avoids having to map the build and test dependencies to package names of various distributions.

1. Install `toolbox`

   - Fedora/CentOS/RHEL based distributions:

         sudo dnf install toolbox

   - Debian/Ubuntu based distributions:

         sudo apt install podman-toolbox

2. Create a development toolbox for Cockpit

       toolbox create --image ghcr.io/cockpit-project/tasks -c cockpit

3. Enter the toolbox:

       toolbox enter cockpit

Your home directory, user D-Bus, etc. are shared with the host, so you can
edit files as you normally would. Building and running tests happens inside the
toolbox container. If desired, you can install additional packages with
`sudo dnf install`.

The Cockpit team occasionally refreshes the `tasks` container image.
To re-create your development container from the latest image, run:

    podman pull ghcr.io/cockpit-project/tasks
    toolbox rm cockpit

...and then repeat steps 2 and 3 from above.

## Working on Cockpit's session pages

Most contributors want to work on the web (HTML, JavaScript, CSS) parts of Cockpit.
First, install Cockpit on your local machine as described in:

<https://cockpit-project.org/running.html>

Next, run this command from your top level Cockpit checkout directory, and make
sure to run it as the same user that you'll use to log into Cockpit below.

    mkdir -p ~/.local/share/
    ln -s $(pwd)/dist ~/.local/share/cockpit

This will cause cockpit to read JavaScript, HTML, and CSS files directly from the
locally built package output directory instead of using the system-installed Cockpit
files.

Now you can log into Cockpit on your local Linux machine at the following
address. Use the same user and password that you used to log into your Linux
desktop.

<http://localhost:9090>

After every change to the source files, bundles need to be rebuilt. The
recommended and fastest way is to do that is using the "watch" mode (`-w` or
`--watch`) on the page that you are working on. For example, if you want to
work on anything in [pkg/systemd](./pkg/systemd/), run:

    ./build.js -w systemd

See [pkg/](./pkg/) for a list of all pages.

If you work on a change that affects multiple pages (such as a file in
pkg/lib/), you can also build all pages:

    ./build.js -w

Reload cockpit in your browser after page is built. Press `Ctrl`-`C` to
stop watch mode once you are done with changing the code.

You often need to test code changes in a VM. You can set the `$RSYNC` env
variable to copy the built page into the given SSH target's
/usr/local/share/cockpit/ directory. If you use Cockpit's own test VMs and set up the
SSH `c` alias as described in [test/README.md](./test/README.md), you can use
one of these commands:

    RSYNC=c ./build.js -w kdump
    RSYNC=c ./build.js -w

To make Cockpit use system packages again, instead of your checkout directory,
remove the symlink with the following command and log back into Cockpit:

    rm ~/.local/share/cockpit

## Working on the non-web parts of Cockpit

Cockpit uses autotools, so there are familiar `./configure` script and
Makefile targets.

After a fresh clone of the Cockpit sources, you need to prepare them by running
`autogen.sh` like this:

    ./autogen.sh --prefix=/usr --enable-debug

As shown, `autogen.sh` runs 'configure' with the given options, and it also
prepares the build tree by downloading various nodejs dependencies.

When working with a Git clone, it is best to always run `./autogen.sh`
instead of `./configure`.

Then run

    make

to build everything. Cockpit has a single non-recursive Makefile. You can only
run `make` from the top-level and it will always rebuild the whole project.

You can run unit tests of the current checkout:

    make check

These should finish very quickly. It is a good practice to do this often.

For debugging individual tests, there are compiled binaries in the build
directory. For QUnit tests (JavaScript), you can run

    ./test-server

which will output a URL to connect to with a browser, such as
<http://localhost:8765/qunit/base1/test-dbus.html>. Adjust the path for different
tests and inspect the results there.

You can also run individual tests by specifying the `TESTS` environment
variable:

    make check TESTS=qunit/base1/test-chan.html

There are also static code and syntax checks which you should run often:

    test/static-code

It is highly recommended to set up a git pre-push hook, to avoid pushing PRs
that will fail on trivial errors:

    ln -s ../../tools/git-hook-pre-push .git/hooks/pre-push

This calls `test/static-code` for each commit you're trying to push.

You can also set up a post-commit hook to do the same, after each commit:

    ln -s ../../tools/git-hook-post-commit .git/hooks/post-commit

We also have a hook to ameliorate one of the more annoying drawbacks of using
git submodules:

    ln -s ../../tools/git-hook-pre-rebase .git/hooks/pre-rebase

## Running the integration test suite

Refer to the [testing README](test/README.md) for details on running the Cockpit
integration tests locally.

## Python bridge

Most distro releases now ship a replacement for the C bridge written in Python.
It resides in `src/cockpit` with most of its rules in `src/Makefile.am`.  This
directory was chosen because it matches the standard so-called "src layout"
convention for Python packages, where each package (`cockpit`) is a
subdirectory of the `src` directory.

### Running the bridge

The Python bridge can be used interactively on a local machine:

    PYTHONPATH=src python3 -m cockpit.bridge

To make it easy to test out channels without having to write out messages
manually, `cockpit.misc.print` can be used:

    PYTHONPATH=src python3 -m cockpit.misc.print open fslist1 path=/etc watch=False | PYTHONPATH=src python3 -m cockpit.bridge

These shell aliases might be useful when experimenting with the protocol:

    alias cpy='PYTHONPATH=src python3 -m cockpit.bridge'
    alias cpf='PYTHONPATH=src python3 -m cockpit.misc.print'

When working with the Python bridge on test images, note that `RHEL/CentOS 8`,
`debian-stable`, and `ubuntu-2204` still use the C bridge. So if you want to
explicitly have the Python bridge on those images use:

    ./test/image-prepare --python

To enable debug logging in journal on a test image, you can pass `--debug` to
`image-prepare`. This will set `COCKPIT_DEBUG=all` to `/etc/environment`, if
you are only interested channel debug messages change `all` to
`cockpit.channel`.

### Testing the Python bridge

There are a growing number of Python `unittest` tests being written to test
parts of the new bridge code.  You can run these with `make pytest` or
`make pytest-cov`.  Those are both just rules to make sure that the
`systemd_ctypes` submodule is checked out before running `pytest` from the
source directory.

The tests require at least `pytest` 7.0.0 or higher to run.

## Running eslint

Cockpit uses [ESLint](https://eslint.org/) to automatically check JavaScript
code style in `.js` and `.jsx` files.

The linter is executed as part of `test/static-code`.

For developer convenience, the ESLint can be started explicitly by:

    npm run eslint

Most rule violations can be automatically fixed by running:

    npm run eslint:fix

Rules configuration can be found in the `.eslintrc.json` file.

During fast iterative development, you can also choose to not run eslint, by
running `./build.js` with the `-e`/`--no-eslint` option. This
speeds up the build and avoid build failures due to ill-formatted comments,
unused identifiers, and other JavaScript-related issues.

## Running stylelint

Cockpit uses [Stylelint](https://stylelint.io/) to automatically check CSS code
style in `.css` and `.scss` files.

The linter is executed as part of `test/static-code`.

For developer convenience, the Stylelint can be started explicitly by:

    npm run stylelint

But note that this only covers files in `pkg/`. `test/static-code` covers
*all* (S)CSS files tracked in git.

Some rule violations can be automatically fixed by running:

    npm run stylelint:fix

Rules configuration can be found in the `.stylelintrc.json` file.

During fast iterative development, you can also choose to not run stylelint, by
running `./build.js` with the `-s`/`--no-stylelint` option. This speeds up the
build and avoids build failures due to ill-formatted CSS or other issues.

## Working on your local machine: Web server

To test changes to the login page or any other resources, you can bind-mount the
build tree's `dist/static/` directory over the system one:

    sudo mount -o bind dist/static/ /usr/share/cockpit/static/

Likewise, to test changes to the branding, use:

    sudo mount -o bind src/branding/ /usr/share/cockpit/branding/

After that, run `systemctl stop cockpit.service` to ensure that the web server
restarts on the next browser request.

To make Cockpit use system-installed code again, umount the paths:

    sudo umount /usr/share/cockpit/static/ /usr/share/cockpit/branding/
    systemctl stop cockpit.service

Similarly, if you change `cockpit-ws` itself, you can make the system (systemd
units, cockpit-tls, etc.) use this:

    sudo mount -o bind cockpit-ws /usr/libexec/cockpit-ws

On Debian-based OSes (including Ubuntu), the path will be
`/usr/lib/cockpit/cockpit-ws` instead.

On Fedora, CentOS, Red Hat Enterprise Linux, and related distributions, you also
need to disable SELinux with:

    sudo setenforce 0

for this to work, as your local build tree does not otherwise have the expected
SELinux type.

Some cockpit binaries rely on specific paths in /usr/share or libexecdir to be
set correctly. By default they are set to `/usr/local`.

On RPM based systems, this can be set using an autogen.sh argument;
afterwards you need to rebuild:

    ./autogen.sh rpm

## Installation from upstream sources

    make
    sudo make install

This will install Cockpit and all support files. If you have a
Fedora/RHEL/CentOS based distribution, install a PAM configuration with

    sudo cp tools/cockpit.pam /etc/pam.d/cockpit

If you have a Debian/Ubuntu based distribution, install this PAM config instead:

    sudo cp tools/cockpit.debian.pam /etc/pam.d/cockpit

For other distributions you need to create a PAM config yourself.

If you prefer to install to a different `--prefix` and would prefer
that `make install` not write outside that prefix, then specify the
`--enable-prefix-only` option to `autogen.sh`. This will result in an
installation of Cockpit that does not work without further tweaking.
For advanced users only.

## Build distribution packages

Instead of a direct `make install` as above, you can also build distribution
packages and install them. This is generally more robust, as they upgrade and
remove cleanly, and don't interfere with distribution packages in `/usr`.

In a Fedora/RHEL build environment you can build binary RPMs with

    tools/make-rpms --quick

In a Debian/Ubuntu build environment you can build debs with

    tools/make-debs --quick

## Updating `node_modules`

During a normal build from a git checkout, the `node_modules` will be
automatically unpacked from a cache kept in a separate git repository.  You can
force the unpack to occur using the `tools/node-modules checkout` command, but
this shouldn't be necessary.  In the event that you need to modify
`package.json` (to install a new module, for example) then you'll need to run
`tools/node-modules install` to create a new cache from the result of running
`npm install` on your new `package.json`.

Your locally rebuilt changes to `node_modules` won't be used by others.  A new
version will be created by a GitHub workflow when you open your pull request.

The `tools/node-modules` script inspects the `GITHUB_BASE` environment variable
to determine the correct repository to use when fetching and pushing.  It will
strip the repository name (leaving the project- or username) and use the
`node-cache.git` repository in that namespace.  If `GITHUB_BASE` is unset, it
will default to `cockpit-project/node-cache.git`.

A local cache is maintained in `~/.cache/cockpit-dev`.

## Contributing a change

Make a pull request on github.com with your change. All changes get reviewed,
tested, and iterated on before getting into Cockpit. The general workflow is
described in the [wiki](https://github.com/cockpit-project/cockpit/wiki/Workflow).

You need to be familiar with git to contribute a change. Do your changes
on a branch. Your change should be one or more git commits that each contain one
single logical simple reviewable change, without modifications that are
unrelated to the commit message.

Don't feel bad if there's multiple steps back and forth asking for changes or
tweaks before your change gets in. If you fix your commits after getting a
review, just force-push to your branch -- this will update the pull request
automatically. Do *not* close it and open a new one; that would destroy the
conversation and reviews.

Cockpit is a designed project. Anything that the user will see should have
design done first. This is done on the wiki and mailing list.

Bigger changes need to be discussed on the
[#cockpit:fedoraproject.org](https://matrix.to/#/#cockpit:fedoraproject.org)
Matrix channel or our mailing list
[cockpit-devel@lists.fedoraproject.org](https://lists.fedorahosted.org/admin/lists/cockpit-devel.lists.fedorahosted.org/)
before you invest too much time and energy.

Feature changes should have a video and/or screenshots that show the change.
This video should be uploaded directly to GitHub on the pull request or issue
or uploaded to YouTube or another service that allows video embedding.

Use a command like this to record a video including the browser
frame:

```
recordmydesktop -x 1 -y 200 --width 1024 --height 576 \
   --fps 24 --freq 44100 --v_bitrate 2000000
```

(This command only works on X11 and requires the `recordmydesktop` program to
be installed.)

You can also resize your browser window and move it to the right location with
a script. In Firefox you can open the Scratchpad (`Shift+F4`) and enter the
following commands:

    window.resizeTo(1024, 576);
    window.moveTo(1, 200);

Then run it with `Ctrl+R` when the browser is showing an empty tab, e.g.
`about:newtab`. You may need to adjust the positions for your environment.

## Debug logging of Cockpit processes

All messages from the various cockpit processes go to the journal and can be
seen with commands like:

    sudo journalctl -f

Much of Cockpit has verbose internal debug logging that can be enabled when
trying to track down a problem. To turn it on add a file to your system like
this:

    sudo mkdir -p /etc/systemd/system/cockpit.service.d
    sudo sh -c 'printf "[Service]\nEnvironment=G_MESSAGES_DEBUG=cockpit-ws,cockpit-bridge\nUser=root\nGroup=\n" > /etc/systemd/system/cockpit.service.d/debug.conf'
    sudo systemctl daemon-reload
    sudo systemctl restart cockpit

In the above command you'll notice the string "cockpit-ws". This is a log
domain. There are various log domains you can enable:

 * cockpit-bridge: Cockpit bridge detailed debug messages
 * cockpit-protocol: Very verbose low level traffic logging
 * cockpit-ws: Cockpit Web Service detailed debug messages
 * WebSocket: Verbose low level WebSocket logging

To revert the above logging changes:

    sudo rm /etc/systemd/system/cockpit.service.d/debug.conf
    sudo systemctl daemon-reload
    sudo systemctl restart cockpit

## Debug logging in Javascript console

Various javascript methods in Cockpit can show debug messages. You can turn them
on by setting a `window.debugging` global, or setting up a `debugging` property
in the browser storage. To do this run the following in your javascript console:

    >> sessionStorage.debugging = "all"

You'll notice that there's a ton of messages that get shown. If you
want to be more specific, instead of "all" use one or more of the following
specific types:

    "all"      // All available debug messages
    "channel"  // All channel messages sent to server
    "dbus"     // DBus related debug messages
    "http"     // HTTP (via the server) related debug messages
    "spawn"    // Debug messages related to executing processes

There are other strings related to the code you may be working on. For example,
the metrics page shows debug information with the value `metrics`. Do
`git grep window.debugging pkg` to find out all available ones.

In addition, if you want your debug setting to survive a browser refresh or
Cockpit log out, use something like:

    >> localStorage.debugging = "spawn"

## Running Cockpit processes under a debugger

You may want to run cockpit-ws under a debugger such as valgrind or gdb. You can
run these processes as your own user, although you won't be able to debug all
the authentication logic in those cases.

First of all, make sure Cockpit is correctly installed. Even though we will be
running `cockpit-ws` from the built sources, this still relies on some of the right
software being installed in order for Cockpit to work. (Such as: PAM stack,
UI files, cockpit-bridge, etc.)

This is how you would run cockpit-ws under gdb:

    export G_DEBUG=fatal-criticals
    export G_MESSAGES_DEBUG=cockpit-ws,cockpit-wrapper,cockpit-bridge
    gdb --args ./cockpit-ws --port 10000 --no-tls

And you can run cockpit-ws and cockpit-bridge under valgrind like this:

    export G_DEBUG=fatal-criticals
    export G_MESSAGES_DEBUG=cockpit-ws,cockpit-wrapper,cockpit-bridge
    valgrind --trace-children=yes --trace-children-skip='*unix_chkpwd*' \
          ./cockpit-ws --port 10000 --no-tls

Note that cockpit-session and cockpit-bridge will run from the installed
prefix, rather than your build tree.

## Manually installing the development dependencies

_If at all possible, use the cockpit/tasks container with toolbox/distrobox as
documented above. Installing all necessary development packages manually on
your machine is intrusive, error prone, difficult, and hard to debug._

You will need at least node.js and NPM.

On Fedora or CentOS (>= 9):

    sudo dnf install npm

On Debian/Ubuntu:

    sudo apt install npm

For running tests, the following dependencies are required:

    sudo dnf install curl expect xz rpm-build chromium-headless dbus-daemon \
        libvirt-daemon-driver-storage-core libvirt-daemon-driver-qemu libvirt-client python3-libvirt \
        python3-flake8 python3-pyyaml

For compiling the C parts, you will need the package build dependencies:

    sudo dnf install dnf-utils python-srpm-macros
    sudo dnf builddep --spec tools/cockpit.spec
