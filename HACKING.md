# Hacking on Cockpit

It is recommended that you create one or more dedicated virtual
machines to try out and develop Cockpit.

While playing with Cockpit you will very likely want to run
experimental code that does dangerous things, such as formatting block
devices.  And even if the code has no bugs, you might want to
intentionally do destructive things that you would never want to do to
a production system.  And last but not least, it is easier to add more
virtual hardware to a virtual machine for testing, such as more hard
disks or network adapters.

## Using Vagrant

It's possible to test and work on Cockpit web assets by just using
Vagrant. In the top level directory of the repository, you can run:

    $ sudo vagrant up

Cockpit will listen on port 9090 of the vagrant VM started, and also
port 9090 of localhost if cockpit is not running locally. Any changes
you make to the system in the Vagrant VM won't affect the host machine.

You can edit files in the `pkg/` subdirectory of the Cockpit sources
and the changes should take effect immediately in the Vagrant VM.

The Vagrant VM is in debug mode, which means that resources will load
into your web browser more slowly than in a production install of
Cockpit.

You may need to rebuild the Vagrant VM periodically, by running:

    $ sudo vagrant destroy
    $ sudo vagrant up

## Development Dependencies

For more complex hacking on Cockpit, you need to build Cockpit locally
and install the relevant dependencies. Currently, recent x86_64
architectures of Fedora are most often used for development.

Check `tools/cockpit.spec` for the concrete Fedora build dependencies.
The following should work in a fresh Git clone:

    $ sudo yum-builddep tools/cockpit.spec
    $ sudo yum install nodejs npm

In addition for testing the following dependencies are required:

    $ sudo yum install python-libguestfs qemu mock qemu-kvm rpm-build \
         curl libvirt-client libvirt-python libvirt python-lxml \
         krb5-workstation krb5-server selinux-policy-devel

    $ sudo npm install -g phantomjs

## Building and installing

Cockpit uses the autotools and thus there are the familiar `./configure`
script and the familar Makefile targets.

But after a fresh clone of the Cockpit sources, you need to prepare
them by running `autogen.sh`.  Maybe like so:

    $ mkdir build
    $ cd build
    $ ../autogen.sh --prefix=/usr --enable-maintainer-mode --enable-debug

As shown, `autogen.sh` also runs 'configure' with the given options, and it
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

## Checking

You can run unit tests of the current checkout:

    $ make check

These should finish very quickly and it is good practice to do it
often.

To run the integration tests, see `test/README`.

## Running

Once Cockpit has been installed, the normal way to run it is via
systemd:

    # systemctl start cockpit.socket

This will cause systemd to listen on port 9090 and start cockpit-ws
when someone connects to it.  Cockpit-ws will in turn activate
cockpit-bridge when someone logs in successfully.

To run Cockpit without systemd, start the cockpit-ws daemon manually:

    # /usr/libexec/cockpit-ws

Then you can connect to port 9090 of the virtual machine.  You might
need to open the firewall for it.  On Fedora:

    # firewall-cmd --reload
    # firewall-cmd --add-service=cockpit
    # firewall-cmd --add-service=cockpit --permanent

Point your browser to `https://IP-OR-NAME-OF-YOUR-VM:9090`

and Cockpit should load after confirming the self-signed certificate.
Log in as root with the normal root password (of the virtual machine).

Cockpit consists of the systemd service: cockpit.service .
After installing a new version, you should usually restart it:

    # systemctl restart cockpit

and then reload the browser.

If you want to run `/usr/libexec/cockpit-ws` outside of systemd, stop
it first, including the socket:

    # systemctl stop cockpit.socket cockpit

## Making a change

Simple version. Edit the appropriate sources and then:

    $ make
    $ sudo make install
    $ sudo systemctl restart cockpit

Then refresh in your browser and your change should be visible. Note that
for pure javascript changes you probably don't need to do the last part.

## Contributing a change

Bigger changes need to be discussed on #cockpit or our mailing list
cockpit-devel@lists.fedoraproject.org before you invest too much time and
energy.

Cockpit is a designed project. Anything that the user will see should have
design done first. This is done on the wiki and mailing list.

You need to be familiar with git to contribute a change. Do your changes
on a branch. Your change should be one or more git commits that each
contain one single logical simple reviewable change, without modifications
that are unrelated to the commit message.

Make a pull request on github.com with your change. All changes get
reviewed, tested and iterated on before getting into Cockpit. Don't feel
bad if there's multiple steps back and forth asking for changes or tweaks
before your change gets in.

## Making Changes in the UI Code

The Cockpit UI code is comprised of HTML, javascript and CSS. Almost all of
this code is found in the packages in the pkg/ subdirectory of
the Cockpit code.

You can setup a system for rapid development of Cockpit UI code. This will
allow you to simply refresh your browser and see any changes you've made
to code in the pkg/ subdirectory.

Run this command from your top level Cockpit checkout directory, and make
sure to run it as the user that you will be using to log into Cockpit.

    $ mkdir -p ~/.local/share/cockpit
    $ ln -s $(pwd)/pkg/* ~/.local/share/cockpit

This will cause cockpit to read UI files directly from the Cockpit code
pkg/ directory instead of using the installed Cockpit UI files. But
only for the user which ran the above command.

To revert the above change, run:

    $ rm -r ~/.local/share/cockpit

## Debug logging of Cockpit processes

All messages from the various cockpit services go to the journal and can
be seen with commands like:

    $ sudo journalctl -f

Much of Cockpit has more verbose internal debug logging that can be
enabled when trying to track down a problem. To turn it on add a file
to your system like this:

    $ sudo mkdir -p /etc/systemd/system/cockpit.service.d
    $ sudo sh -c 'printf "[Service]\nEnvironment=G_MESSAGES_DEBUG=cockpit-ws,cockpit-wrapper,cockpit-bridge\nUser=root\nGroup=\n" > /etc/systemd/system/cockpit.service.d/debug.conf'
    $ sudo systemctl daemon-reload
    $ sudo systemctl restart cockpit

In the above command you'll notice the string "cockpit-ws". This is a log
domain. There are various log domains you can enable:

 * cockpit-bridge: Cockpit bridge detailed debug messages
 * cockpit-wrapper: Cockpit DBus wrapper detailed debug messages
 * cockpit-protocol: Very verbose low level traffic logging
 * cockpit-ws: Cockpit Web Service detailed debug messages
 * WebSocket: Verbose low level WebSocket logging

To revert the above logging changes:

    $ sudo rm /etc/systemd/system/cockpit.service.d/debug.conf
    $ sudo systemctl daemon-reload
    $ sudo systemctl restart cockpit

## Debug logging of Cockpit protocol

Cockpit communicates with the system via a WebSocket. To log all
communication to the Web Browser's console, run one of the following
commands in the console:

    > window.debugging = "channel"

Or in order to log starting at page reload:

    > window.sessionStorage["debugging"] = "channel"

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

## Setting up a domain server

Some features of Cockpit require a domain to test. Cockpit should work
with either Active Directory or IPA.

If you do not have a domain available that you can use, or don't have
sufficient privileges on the domain to test Cockpit's features, you can
use the IPA server that comes with from Cockpit's integration tests.
The domain is called 'cockpit.lan'. On a physical machine, with the
cockpit sources checked out, here's how you get it running:

    $ cd /path/to/src/cockpit
    $ cd ./test
    $ ./vm-prep
    $ ./vm-download -f ipa
    $ ./vm-run -f ipa

The IP address of the IPA server will be printed. The root password
is `foobar`. The IPA admin password is `foobarfoo`.

Your client machines (with your web browser) and your server machines
(with cockpit running) need to be able to resolve DNS queries against
the IPA server. You can do the following to make that happen:

    $ sudo -s
    # echo -e 'domain cockpit.lan\nnameserver 10.111.111.100\n' > \
            /etc/resolv.conf

To test your DNS, the following should succeed without any error messages
on both your client machines, and your server with cockpit:

    $ host cockpit.lan

Now verify that you can authenticate against the IPA server. See password
above.

    $ kinit admin@COCKPIT.LAN
    Password for admin@COCKPIT.LAN:

**BUG:** IPA often fails to start up correctly on system boot. You may
have to log into the IPA server and run `systemctl start ipa`.
[ipa bug](https://bugzilla.redhat.com/show_bug.cgi?id=1071356)

## Setting up Single Sign on

Cockpit can perform single sign on authentication via Kerberos. To test and
work on this feature, you must have a domain on your network. See section
above if you do not.

Use the following guide to configure things, with more troubleshooting advice
below:

http://files.cockpit-project.org/guide/sso.html

**BUG:** The host name of the computer Cockpit is running on should end with
the domain name. If it does not, then rename the computer Cockpit is running on:
[realmd bug](https://bugzilla.redhat.com/show_bug.cgi?id=1144343)

    $ sudo hostnamectl set-hostname my-server.domain.com

**BUG:** If your domain is an IPA domain, then you need to explictly add a service
before Cockpit can be used with Single Sign on. The following must be done on
the computer running Cockpit.
[realmd bug](https://bugzilla.redhat.com/show_bug.cgi?id=1144292)

    $ sudo -s
    # kinit admin@COCKPIT.LAN
    # curl -s --negotiate -u : https://f0.cockpit.lan/ipa/json \
            --header 'Referer: https://f0.cockpit.lan/ipa' \
            --header "Content-Type: application/json" \
            --header "Accept: application/json" \
            --data '{"params": [["HTTP/my-server.cockpit.lan@COCKPIT.LAN"], {"raw": false, "all": false, "version": "2.101", "force": true, "no_members": false}], "method": "service_add", "id": 0}'
    # ipa-getkeytab -q -s f0.cockpit.lan -p HTTP/my-server.cockpit.lan \
            -k /etc/krb5.keytab

Now when you go to your cockpit instance you should be able to log in without
authenticating. Make sure to use the full hostname that you set above, the one
that includes the domain name.

If you want to use Cockpit to connect to a second server. Make sure that second
server is joined to a domain, and that you can ssh into it using GSSAPI authentication
with the domain user:

    $ ssh -o PreferredAuthentications=gssapi-with-mic admin@my-server2.domain.com

If you thought that was nasty and tiresome, it's because it is at present :S


## Cockpit Web Service Privileged Container

It is possible, to run Cockpit in a privileged container. The Dockerfile for
this is here:

https://github.com/cockpit-project/cockpit-container
