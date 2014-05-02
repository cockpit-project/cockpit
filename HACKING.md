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

## Dependencies

The development version of Cockpit very likely has dependencies on
other packages that can't yet be satisfied by the main distribution.

Sometimes this is just a newer version of a package, or a new package
altogether that hasn't yet made it into the main distribution.
Sometimes, we depend on experimental patches to other projects that
might or might not get accepted upstream.

For supported OS distributions and architectures, we have repositories
with pre-build binary packages of all needed dependencies.

### Fedora:

Currently the 64-bit architectures of Fedora 20 and Rawhide are most
often used for development.

Check `test/cockpit.spec.in` for the concrete build dependencies.  The following
should work in a fresh Git clone:

    $ cd ./test
    $ srpm=$(./make-srpm)
    # yum-builddep $srpm

## Building and installing

Cockpit uses the autotools and thus there are the familiar `./configure`
script and the familar Makefile targets.

But after a fresh clone of the Cockpit sources, you need to prepare
them by running autogen.sh.  Maybe like so:

    $ mkdir build
    $ cd build
    $ ../autogen.sh --prefix /usr --enable-maintainer-mode --enable-debug

As shown, autogen.sh also runs 'configure' with the given options.
When working with a Git clone, it is therefore best to simply always
run ../autogen.sh instead of `../configure`.

Creating a build directory puts the output of the build in a separate
directory, rather than mixing it in with the sources, which is confusing.

Then you can build the sources and install them, as usual:

    $ make
    $ sudo make install
    $ sudo cp ../data/cockpit.pam.insecure /etc/pam.d/cockpit

This will install Cockpit and all support files, and will install a
simplistic PAM configuration.

Cockpit has a single non-recursive Makefile.  You can only run `make`
from the top-level and it will always rebuild the whole project.

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

This will cause systemd to listen on port 21064 and start cockpit-ws
when someone connects to it.  Cockpit-ws will in turn activate
cockpitd via D-Bus when someone logs in successfully.

To run Cockpit without systemd, start the cockpit-ws daemon manually:

    # /usr/libexec/cockpit-ws

Then you can connect to port 21064 of the virtual machine.  You might
need to open the firewall for it.  On Fedora:

    # firewall-cmd --add-port 21064/tcp
    # firewall-cmd --permanent --add-port 21064/tcp

Point your browser to `https://IP-OR-NAME-OF-YOUR-VM:21064`

and Cockpit should load after confirming the self-signed certificate.
Log in as root with the normal root password (of the virtual machine).

Cockpit consists of two main systemd services: cockpitd.service and
cockpit.service.  After installing a new version, you should
usually restart both of them

    # systemctl restart cockpit cockpitd

and then reload the browser.

If you want to run `/usr/libexec/cockpitd` or `/usr/libexec/cockpit-ws`
outside of systemd, stop them first, including the socket:

    # systemctl stop cockpit.socket cockpit cockpitd

## Making a change

Simple version. Edit the appropriate sources and then:

    $ make
    $ sudo make install
    $ sudo systemctl restart cockpit cockpitd

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

## Updating Patternfly

Right now, it's a manual process.

Cockpit uses a different directory layout than Patternfly and you need
to adjust some paths in `patternfly/less/variables.less`:

    @icon-font-path:  "fonts";
    @fa-font-path:    "fonts";
    @font-path:       "fonts";
    @img-path:        "images";

Then rebuild Patternfly and copy the files you need into `./lib/`,
`./lib/images/`, and `./lib/fonts/`, as appropriate.
