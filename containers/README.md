Cockpit Containers
==================

Much of Cockpit is a system configuration and troubleshooting tool. It doesn't
all work in a container. But there are parts that do.


Contributing
============

Here are some commands to use while hacking on the containers. Replace
'xxx' with the name of the container. That is the name of the directory.
When running docker the 'sudo' command will be used to get necessary
privileges.

Build the given container:

    $ make xxx-container

Run the given built container and log in interactively as a shell:

    $ make xxx-container-shell
