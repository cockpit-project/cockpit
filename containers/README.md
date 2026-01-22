Cockpit Containers
==================

 * [ws](./ws/): Cockpit's web server, for installation on CoreOS; uses SSH to connect to the local host or remote machines
 * [bastion](./bastion/): A reduced variant of the web server that runs unprivileged, and can only connect to remote machines. Suitable for deploying on e.g. Kubernetes. This is currently a prototype.
 * [unit-tests](./unit-tests/): Our project's unit tests run in this container; usually on GitHub PRs, but you can also run it locally for reproducing failures.
 * [flatpak](./flatpak/): Scripts for locally building, running, and testing our [Cockpit Client flatpak](https://github.com/flathub/org.cockpit_project.CockpitClient).

See the individual README.md files in the subdirectories for details.

ws container development
========================

Build the container:

    make ws-container

You can install locally built RPMs by copying them into the `ws/rpms/`
directory.

For fast iteration, you can also build the container with the binaries
(`cockpit-ws`, `cockpit-tls`, etc.) and the pages (`dist/*`) from the local
build tree. For that to work, you *have* to build the project on the same OS as
the container, and configure with `--prefix=/usr`. No warranties, you have to
know what you are doing!

    make ws-container-build-tree

Run the built container and log in interactively as a shell:

    make ws-container-shell

When running docker the 'sudo' command will be used to get necessary
privileges.
