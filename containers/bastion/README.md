Bastion Container
====================

This container provides an example of a container that can be used as a bastion to connect via ssh to remote servers that do not have the cockpit webservice installed or exposed. The target server is expected to at minimum have the `cockpit-system` package installed. This container can be run in two modes.

By default on login cockpit will attempt to establish a ssh connection to the given host using the username and password provided.

You can also mount an encrypted private key inside the container and set the environment variable `COCKPIT_SSH_KEY_PATH` to point to it.

`docker run -e COCKPIT_SSH_KEY_PATH='/var/secret/id_rsa' -v ~/.ssh/id_rsa:/var/secret/id_rsa cockpit/bastion:Z`

When setup like this cockpit will use the provided password to attempt to decrypt the key and attempt to establish a ssh connection to the given host using that private key.


Host keys
--------------------

You should mount your known host keys into the container at `/etc/ssh_known_hosts`

You can use the environment variable `COCKPIT_SSH_KNOWN_HOSTS_FILE` to specify a different location.

Cockpit will only attempt to communicate with hosts that are present in your known hosts file. If you want to allow the bastion to attempt to access any host set the environment variable `COCKPIT_SSH_CONNECT_TO_UNKNOWN_HOSTS` to true.
