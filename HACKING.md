# Hacking on Cockpit

Here's where to get the code:

    $ git clone https://github.com/cockpit-project/cockpit
    $ cd cockpit/

The remainder of the commands assume you're in the top level of the
Cockpit git repository checkout.

Cockpit uses Node.js during development. Node.js is not used at runtime.
To make changes on Cockpit you'll want to install Node.js, NPM and
various development dependencies like Webpack.

On Debian or Ubuntu:

    $ sudo apt-get install nodejs npm

On Fedora:

    $ sudo yum install nodejs npm
    $ sudo npm install -g webpack

And lastly get Webpack and the development dependencies:

    $ sudo npm install -g webpack
    $ npm install

## Working on Cockpit using Vagrant

It is recommended to use a Vagrant virtual machine to develop Cockpit.

Most of Cockpit is written in javascript. Almost all of this code is found
in the packages in the pkg/ subdirectory of the Cockpit git checkout.

To use Vagrant to develop Cockpit, run in its top level git checkout.
In some cases you may need to use `sudo` with vagrant commands:

    $ vagrant up

Next can edit files in the `pkg/` subdirectory of the Cockpit sources.
Use the `webpack` command to build the those sources. The changes should
take effect after syncing them to the Vagrant VM. For example:

    $ webpack
    $ vagrant rsync

Now log into Cockpit on the vagrant VM to see your changes. Use the
user name 'admin' and the password 'foobar' to log in. The Cockpit
instance in vagrant should be available at the following URL:

http://localhost:9090

If you want to setup automatic syncing as you edit javascript files
you can:

    $ vagrant rsync-auto &
    $ webpack --progress --colors --watch

## Working on your local machine

It's easy to set up your local Linux machine for rapid development of Cockpit's
javascript code. First install Cockpit on your local machine as described in:

http://cockpit-project.org/running.html

Next run this command from your top level Cockpit checkout directory, and make
sure to run it as the same user that you'll use to log into Cockpit below.

    $ mkdir -p ~/.local/share/
    $ ln -s $(pwd)/dist ~/.local/share/cockpit

This will cause cockpit to read javascript and HTML files directly from the built
package output directory instead of using the installed Cockpit UI files.

Next run Webpack to build the javascript code:

    $ webpack

Now you can log into Cockpit on your local Linux machine at the following address.
Use the same user and password that you used to log into your Linux desktop.

http://localhost:9090

If you want to setup automatic syncing as you edit javascript files you can:

    $ webpack --progress --colors --watch

To make Cockpit again use the installed code, rather than that from your
git checkout directory, run the following, and log into Cockpit again:

    $ rm ~/.local/share/cockpit

## Contributing a change

Make a pull request on github.com with your change. All changes get
reviewed, tested and iterated on before getting into Cockpit. Don't feel
bad if there's multiple steps back and forth asking for changes or tweaks
before your change gets in.

You need to be familiar with git to contribute a change. Do your changes
on a branch. Your change should be one or more git commits that each
contain one single logical simple reviewable change, without modifications
that are unrelated to the commit message.

Cockpit is a designed project. Anything that the user will see should have
design done first. This is done on the wiki and mailing list.

Bigger changes need to be discussed on #cockpit or our mailing list
cockpit-devel@lists.fedoraproject.org before you invest too much time and
energy.

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

## Building Cockpit binaries

For more complex hacking on Cockpit beyond the user interface, you need to
build the Cockpit binaries locally and install the relevant dependencies.
Currently, recent x86_64 architectures of Fedora are most often used for
development.

Check `tools/cockpit.spec` for the concrete Fedora build dependencies.
The following should work in a fresh Git clone:

    $ sudo yum-builddep tools/cockpit.spec
    $ sudo yum install nodejs npm

In addition for testing the following dependencies are required:

    $ sudo yum install python-libguestfs qemu mock qemu-kvm rpm-build \
         curl libvirt-client libvirt-python libvirt python-lxml \
         krb5-workstation krb5-server selinux-policy-devel

    $ npm install phantomjs-prebuilt

Cockpit uses the autotools and thus there are the familiar `./configure`
script and the familar Makefile targets.

But after a fresh clone of the Cockpit sources, you need to prepare
them by running `autogen.sh` like this:

    $ mkdir build
    $ cd build
    $ ../autogen.sh --prefix=/usr --enable-debug

As shown, `autogen.sh` runs 'configure' with the given options, and it
also prepares the build tree by downloading various nodejs dependencies.

When working with a Git clone, it is therefore best to simply always
run `../autogen.sh` instead of `../configure`.

Creating a build directory puts the output of the build in a separate
directory, rather than mixing it in with the sources, which is confusing.

Then you can build the sources and install them, as usual:

    $ make
    $ sudo make install
    $ sudo cp ../src/bridge/cockpit.pam.insecure /etc/pam.d/cockpit
    $ sudo sh -c "cat ../src/bridge/sshd-reauthorize.pam >> /etc/pam.d/sshd"

This will install Cockpit and all support files, and will install a
simplistic PAM configuration.

Cockpit has a single non-recursive Makefile.  You can only run `make`
from the top-level and it will always rebuild the whole project.

If you prefer to install to a different `--prefix` and would prefer
that `make install` not write outside that prefix, then specify the
`--enable-prefix-only` option to `autogen.sh`. This will result in an
installation of Cockpit that does not work without further tweaking.
For advanced users only.

You can run unit tests of the current checkout:

    $ make check

These should finish very quickly and it is good practice to do it
often.

To run the integration tests, see `test/README`.

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
