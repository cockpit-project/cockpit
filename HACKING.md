# Hacking on Cockpit

Here's where to get the code:

    $ git clone https://github.com/cockpit-project/cockpit
    $ cd cockpit/

The remainder of the commands assume you're in the top level of the
Cockpit git repository checkout.

## Getting the development dependencies

Cockpit uses Node.js during development. Node.js is not used at runtime.
To make changes on Cockpit you'll want to install Node.js, NPM and
various development dependencies.

On Debian and recent Ubuntu ≥ 19.04:

    $ sudo apt-get install nodejs npm sassc

On Fedora:

    $ sudo dnf install nodejs npm sassc

On older OS releases you can use the [n utility](https://github.com/tj/n) to
get a current version of npm and nodejs.

When relying on CI to run the test suite, this is all that is
necessary to work on the JavaScript components of Cockpit.

To actually build the Cockpit binaries themselves from source
(including to run the integration tests locally), you will need
additional header files and other components. Check
`tools/cockpit.spec` for the concrete Fedora build dependencies.

Note that `tools/cockpit.spec` is a template filled in by
`tools/gen-spec-dependencies`, and cannot be directly parsed by dnf.
The following should work in a fresh Git clone:

    $ sudo dnf install dnf-utils
    $ TEMPFILE=$(mktemp -u --suffix=.spec) && \
      sed 's/%{npm-version:.*}/0/' tools/cockpit.spec >$TEMPFILE && \
      sudo dnf builddep --spec $TEMPFILE && \
      rm $TEMPFILE

For running the browser unit tests, the following dependencies are required:

    $ sudo dnf chromium-headless dbus-daemon

For running integration tests, the following dependencies are required:

    $ sudo dnf install curl expect xz rpm-build chromium-headless \
        libvirt-daemon-kvm libvirt-client python3-libvirt

Creating VM images locally (not necessary for running tests) needs the following:

    $ sudo dnf install virt-install

## Building

Cockpit uses the autotools and thus there are the familiar `./configure`
script and Makefile targets.

After a fresh clone of the Cockpit sources, you need to prepare them by running
`autogen.sh` like this:

    $ ./autogen.sh --prefix=/usr --enable-debug

As shown, `autogen.sh` runs 'configure' with the given options, and it
also prepares the build tree by downloading various nodejs dependencies.

When working with a Git clone, it is therefore best to simply always
run `./autogen.sh` instead of `./configure`.

Then run

    $ make

to build everything.  Cockpit has a single non-recursive Makefile.  You can
only run `make` from the top-level and it will always rebuild the whole
project.

When building from git, you can optionally set the `NO_NPM` environment
variable to `1` to prevent `autogen.sh` from invoking `npm`.  As a result,
there will be no `node_modules` directory created.  In case this directory is
missing, the build will avoid building the parts of cockpit which are
dependent on node, which can be useful for working on the C parts.  You can
also use `NO_NPM=0` or `NO_NPM=1` as an environment variable or flag to `make`
to force building (or force not building) the node-related parts.

You can run unit tests of the current checkout:

    $ make check

These should finish very quickly and it is good practice to do it
often.

For debugging individual tests, there are compiled binaries in the
build directory. For QUnit tests (JavaScript), you can run

    $ ./test-server

which will output a URL to connect to with a browser, such as
`http://localhost:8765/dist/base1/test-dbus.html`. Adjust the path
for different tests and inspect the results there.

You can also run individual tests by specifying the `TESTS` environment
variable:

    $ make check TESTS=dist/base1/test-chan.html

There are also static code and syntax checks which you should run often:

    $ tools/test-static-code

It is highly recommended to set this up as a git pre-push hook, to avoid
pushing PRs that will fail on trivial errors:

    $ ln -s ../../tools/test-static-code .git/hooks/pre-push

## Running the integration test suite

Refer to the [testing README](test/README.md) for details on running
the Cockpit integration tests locally.

## Running eslint

Cockpit uses [ESLint](https://eslint.org/) to automatically check
JavaScript code style in `.js` and `.jsx` files.

The linter is executed within every build as a webpack preloader.

For developer convenience, the ESLint can be started explicitly by:

    $ npm run eslint

Violations of some rules can be fixed automatically by:

    $ npm run eslint:fix

Rules configuration can be found in the `.eslintrc.json` file.

During fast iterative development, you can also choose to not run eslint. This
speeds up the build and avoids build failures due to e. g.  ill-formatted
comments or unused identifiers:

    $ make ESLINT=0

## Working on your local machine: Cockpit's session pages

It's easy to set up your local Linux machine for rapid development of Cockpit's
JavaScript code (in pkg/). First install Cockpit on your local machine as described in:

https://cockpit-project.org/running.html

Next run this command from your top level Cockpit checkout directory, and make
sure to run it as the same user that you'll use to log into Cockpit below.

    $ mkdir -p ~/.local/share/
    $ ln -s $(pwd)/dist ~/.local/share/cockpit

This will cause cockpit to read JavaScript and HTML files directly from the built
package output directory instead of using the installed Cockpit UI files.

Now you can log into Cockpit on your local Linux machine at the following address.
Use the same user and password that you used to log into your Linux desktop.

http://localhost:9090

After every change to your sources the webpacks need to be rebuilt: You can
just run `make` to update everything that has changed; for iterating faster,
you can run webpack in "watch" mode on the particular page that you are working
on, which reduces the build time to less than a third. E. g.

    $ tools/webpack-watch systemd

Note that this disables eslint by default -- if you want to enable it, run it
as

    $ ESLINT=1 tools/webpack-watch systemd

Then reload cockpit in your browser after building the page.

To make Cockpit again use the installed code, rather than that from your
git checkout directory, run the following, and log into Cockpit again:

    $ rm ~/.local/share/cockpit

## Working on your local machine: Web server

To test changes to the login page or any other resources, you can bind-mount
the build tree's `dist/static/` directory over the  system one:

    $ sudo mount -o bind dist/static/ /usr/share/cockpit/static/

Likewise, to test changes to the branding, use

    $ sudo mount -o bind src/branding/ /usr/share/cockpit/branding/

After that, run `systemctl stop cockpit.service` to ensure that the web server
restarts on the next browser request.

To make Cockpit again use the system-installed code, simply umount these again:

    $ sudo umount /usr/share/cockpit/static/ /usr/share/cockpit/branding/
    $ systemctl stop cockpit.service

Similarly, if you change cockpit-ws itself, you can make the system (systemd
units, cockpit-tls, etc.) use that:

    $ sudo mount -o bind cockpit-ws /usr/libexec/cockpit-ws

On Debian based OSes, the path will be `/usr/lib/cockpit/cockpit-ws` instead.
You need to disable SELinux with

    $ sudo setenforce 0

for this to work, as your local build tree does not otherwise have the expected
SELinux type.

## Installation from upstream sources

    $ make
    $ sudo make install
    $ sudo cp src/bridge/cockpit.pam.insecure /etc/pam.d/cockpit

This will install Cockpit and all support files, and will install a
simplistic PAM configuration.

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

## Contributing a change

Make a pull request on github.com with your change. All changes get
reviewed, tested and iterated on before getting into Cockpit. The general
workflow is described in the [wiki](https://github.com/cockpit-project/cockpit/wiki/Workflow).
Don't feel bad if there's multiple steps back and forth asking for changes
or tweaks before your change gets in.

You need to be familiar with git to contribute a change. Do your changes
on a branch. Your change should be one or more git commits that each
contain one single logical simple reviewable change, without modifications
that are unrelated to the commit message.

Cockpit is a designed project. Anything that the user will see should have
design done first. This is done on the wiki and mailing list.

Bigger changes need to be discussed on #cockpit or our mailing list
cockpit-devel@lists.fedoraproject.org before you invest too much time and
energy.

Feature changes should have a video and/or screenshots that show the
change. This video should be uploaded to Youtube or another service that
allows video embedding. Use a command like this to record a video including
the browser frame:

    $ recordmydesktop -x 1 -y 200 --width 1024 --height 576 \
        --fps 24 --freq 44100 --v_bitrate 2000000

You can also resize your browser window and move it to the right location with
a script. In Firefox you can open the Scratchpad (`Shift+F4`) and enter the
following commands:

    $ window.resizeTo(1024, 576);
    $ window.moveTo(1, 200);

Then run it with `Ctrl+R` when the browser is showing an empty tab, e.g.
`about:newtab`. You may need to adjust the positions for your environment.

## Debug logging of Cockpit processes

All messages from the various cockpit processes go to the journal and can
be seen with commands like:

    $ sudo journalctl -f

Much of Cockpit has more verbose internal debug logging that can be
enabled when trying to track down a problem. To turn it on add a file
to your system like this:

    $ sudo mkdir -p /etc/systemd/system/cockpit.service.d
    $ sudo sh -c 'printf "[Service]\nEnvironment=G_MESSAGES_DEBUG=cockpit-ws,cockpit-bridge\nUser=root\nGroup=\n" > /etc/systemd/system/cockpit.service.d/debug.conf'
    $ sudo systemctl daemon-reload
    $ sudo systemctl restart cockpit

In the above command you'll notice the string "cockpit-ws". This is a log
domain. There are various log domains you can enable:

 * cockpit-bridge: Cockpit bridge detailed debug messages
 * cockpit-protocol: Very verbose low level traffic logging
 * cockpit-ws: Cockpit Web Service detailed debug messages
 * WebSocket: Verbose low level WebSocket logging

To revert the above logging changes:

    $ sudo rm /etc/systemd/system/cockpit.service.d/debug.conf
    $ sudo systemctl daemon-reload
    $ sudo systemctl restart cockpit

## Debug logging in Javascript console

Various javascript methods in Cockpit can show debug messages. You
can turn them on by setting a `window.debugging` global, or setting
up a `debugging` property in the browser storage. To do this
run the following in your javascript console:

    >> sessionStorage.debugging = "all"

You'll notice that there's a ton of messages that get shown. If you
want to be more specific, instead of "all" use one of the following
specific types:

    "all"      // All available debug messages
    "channel"  // All channel messages sent to server
    "dbus"     // DBus related debug messages
    "http"     // HTTP (via the server) related debug messages
    "spawn"    // Debug messages related to executing processes

There are other strings related to the code you may be working on.

In addition, if you want your debug setting to survive a browser refresh
or Cockpit log out, use something like:

    >> localStorage.debugging = "spawn"

## Running Cockpit processes under a debugger

You may want to run cockpit-ws under a debugger such as valgrind or gdb.
You can run these processes as your own user, although you won't be able
to debug all the authentication logic in those cases.

First of all make sure Cockpit is installed correctly. Even though we
will be running cockpit-ws from the built sources this still relies on
some of the right bits being installed in order for Cockpit to work
(ie: PAM stack, UI files, cockpit-bridge, etc.)

This is how you would run cockpit-ws under gdb:

    $ export G_DEBUG=fatal-criticals
    $ export G_MESSAGES_DEBUG=cockpit-ws,cockpit-wrapper,cockpit-bridge
    $ gdb --args ./cockpit-ws --port 10000 --no-tls

And you can run cockpit-ws and cockpit-bridge under valgrind like this:

    $ export G_DEBUG=fatal-criticals
    $ export G_MESSAGES_DEBUG=cockpit-ws,cockpit-wrapper,cockpit-bridge
    $ valgrind --trace-children=yes --trace-children-skip='*unix_chkpwd*' \
          ./cockpit-ws --port 10000 --no-tls

Note that cockpit-session and cockpit-bridge will run from the installed
prefix, rather than your build tree.

# Running Microsoft Edge to test Cockpit

While running Firefox or Chrome on your Linux or Mac development machine
may be easy, some people find it harder to test Edge . To
use the following method you need access to the ```windows-10``` testing
image. This image cannot be freely distributed for licensing reasons.

Make sure you have the ```virt-viewer``` package installed on your Linux
machine. And then run the following from the Cockpit checkout directory:

    $ bots/vm-run windows-10

If the image is not yet downloaded, it'll take a while to download and
you'll see progress on the command line. A screen will pop up and
Windows will boot. Various command lines will show up once Windows has
started. Ignore or minimize them, before starting Edge.

Type the following into Edge's address bar to access Cockpit running on your
development machine:

     https://10.0.2.2:9090
