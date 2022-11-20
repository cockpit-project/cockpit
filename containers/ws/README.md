# Cockpit WS Container

This container is suitable for scenarios where you can not or wish not to deploy the Cockpit Web Service and browser
application natively.

## Tags

The following tags are provided for the image:

- `:latest`, `:latest-amd64`, `:latest-arm64` point to the latest images and their respective architecture
- `:{Cockpit WS Version}`, `:{Cockpit WS Version}-amd64`, `:{Cockpit WS Version}-arm64` (e. g. `:280-amd64`) point to
  images with the specified Cockpit WS version and their respective platform

## Preparing Managed Host

The hosts you want to manage via this container need to have both `cockpit-system` installed and SSH access enabled.

Depending on your configuration, you may want to install
[additional extensions](https://packages.fedoraproject.org/search?query=cockpit-) as well, such as `cockpit-kdump` or
`cockpit-networkmanager`.

The standard Fedora and Red Hat Enterprise Linux CoreOS images do not provide Cockpit packages. If you wish to install
the container on CoreOS or simply manage such a system, you need to follow these
steps to setup Cockpit:

1. Install Cockpit core packages as overlay RPMs:
   ```
   rpm-ostree install cockpit-system cockpit-ostree cockpit-podman
   ```

   If you have a custom-built OSTree, simply include the same packages in your build.

2. Reboot

3. Continue with setting up the Cockpit WS container below

## Running the Cockpit WS Container

There are two modes in which this container can operate.

### Privileged Mode

Privileged mode provides tight integration with the host. You can use the host's users and their passwords to log in,
and Cockpit's branding will adjust to the host operating system.

1. Run the Cockpit web service with a privileged container (as root):
   ```
   podman container runlabel --name cockpit-ws RUN quay.io/cockpit/ws
   ```

2. Make Cockpit start on boot:
   ```
   podman container runlabel INSTALL quay.io/cockpit/ws
   systemctl enable cockpit.service
   ```

### Unprivileged Mode (Bastion Container)

When you run the container without `--privileged`, it presents an unbranded login page. The user always has to specify a
host name, and it connects to that host with SSH.

```
podman run -d \
   --name cockpit \
   -p 9090:9090 \
   quay.io/cockpit/ws
```

You can still log into the container's host if you specify its **public** address or alternatively
`host.containers.internal` if you're running the container with [podman](https://podman.io).

This mode is suitable for deploying to e.g. Kubernetes or similar environments where you can not have or want privileged
containers. In this "bastion" mode you can run Cockpit without ensuring you can connect to the managed hosts directly.
The container can simply sit at the edge between your public and your internal networks.

## Configuration

### Cockpit Configuration

By default, the container uses an [cockpit.conf](https://cockpit-project.org/guide/latest/cockpit.conf.5.html) which
requires you to enter a hostname on every login and displays a neutral login page and title.

You can customize this behaviour and more, by passing your own configuration as a volume:

```
-v /path/to/your/cockpit.conf:/etc/cockpit/cockpit.conf:ro,Z
```

Similarly you can also provide a custom `/etc/os-release` to change the branding, e.g. by using the host's information:

```
-v /etc/os-release:/etc/os-release:ro,Z
```

The container will create a self signed certificate unless one is provided within `/etc/cockpit/ws-certs.d`. You can
provide your own certificate and Cockpit will automatically use it:

```
-v /path/to/your/cert.crt:/etc/cockpit/ws-certs.d/cert.crt:ro,Z \
-v /path/to/your/cert.key:/etc/cockpit/ws-certs.d/cert.key:ro,Z
```

For more guides on configuring Cockpit, see the following pages:

- https://cockpit-project.org/guide/latest/cockpit.conf.5
- https://cockpit-project.org/guide/latest/guide

### SSH Authentication

Normally the the login page asks the user to confirm unknown SSH host key fingerprints. Confirmed keys will be stored in

You can mount your known host keys into the container at `/etc/ssh/ssh_known_hosts`:

```
-v /host/path/to/known_hosts:/etc/ssh/ssh_known_hosts:ro,Z
```

Or mount them to a different location and specify the environment variable `COCKPIT_SSH_KNOWN_HOSTS_FILE`:

```
-v /host/path/to/known_hosts:/container/path/to/known_hosts:ro,Z \
-e COCKPIT_SSH_KNOWN_HOSTS_FILE=/container/path/to/known_hosts
```

The container's default `cockpit.conf` enables you to use a **single** key file as identity when connecting to managed
hosts. If you wish to customize the configuration file, but use SSH authentication, make sure the following lines are
added to your configuration file:

```
[Basic]
Command = /container/cockpit-auth-ssh-key

[Ssh-Login]
Command = /container/cockpit-auth-ssh-key
```

Then mount an **encrypted** private key inside the container and set the environment
variable `COCKPIT_SSH_KEY_PATH` to point to it:

```
-v /host/path/to/key:/container/path/to/key:ro,Z \ 
-e COCKPIT_SSH_KEY_PATH=/container/path/to/key
```

Cockpit will use the provided password on every login to decrypt the key and establish an SSH connection to the given
host using that private key. **If the decryption fails, the provided password will be used for username/password
authentication on the provided host instead.**

## More Information

* [Cockpit Project](https://cockpit-project.org)
* [Cockpit Development](https://github.com/cockpit-project/cockpit)
* [cockpit/ws quay.io page](https://quay.io/repository/cockpit/ws)
