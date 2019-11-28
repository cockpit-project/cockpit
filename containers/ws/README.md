# Cockpit on Fedora CoreOS or other container hosts

Standard Fedora and Red Hat Enterprise Linux CoreOS platforms don't contain any
Cockpit packages. To install these, run

    # rpm-ostree install cockpit-system cockpit-networkmanager

or include these packages into your own OSTree configs, or install them with
the package manager of your operating system.

Depending on your configuration, you may want to use other extensions as well,
like cockpit-kdump or cockpit-podman.

After that you can add this host to another Cockpit dashboard, but not connect to it directly. If you want to do that, you need to run the Cockpit web service with this privileged container:

    # podman container runlabel RUN cockpit/ws

The container will be named "ws" by default. You can use the `--name` option to
assign a different name.

Then use your web browser to log into port 9090 on your host IP address as usual.

# Cockpit Web Service Container on Atomic

Fedora and Red Hat Enterprise Linux Atomic contains the Cockpit bridge (cockpit-bridge package) and basic pages (cockpit-system package). Thus you can connect from remote cockpit hosts through ssh without further modification.

These older operating systems use docker instead of podman and have an `atomic` command that wraps it. To start a web service directly on these hosts, run

    # atomic run cockpit/ws

## More Info

 * [Cockpit Project](https://cockpit-project.org)
 * [Cockpit Development](https://github.com/cockpit-project/cockpit)
