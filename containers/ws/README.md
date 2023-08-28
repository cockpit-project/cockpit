# Cockpit webserver container

[Cockpit](https://cockpit-project.org/) is a web-based graphical interface for Linux servers.
It is [packaged in most major Linux distributions](https://cockpit-project.org/running.html).

This container image provides Cockpit's web server and a subset of available pages (like the cockpit-system package)
for deployment on container hosts such as Fedora CoreOS or Kubernetes, where installing rpms is difficult or impossible.

## Usage on container host distributions

The standard Fedora and Red Hat Enterprise Linux CoreOS images do not contain Cockpit packages. The
`cockpit/ws` container includes a minimal set of builtin Cockpit pages which are being used when connecting to
such a machine, i.e. a host which doesn't have the `cockpit-bridge` package installed.

If these builtin pages are not enough for your use cases, you can install desired Cockpit packages
as overlay RPMs. For example:

```
rpm-ostree install cockpit-system cockpit-ostree cockpit-podman
reboot
```

Depending on your configuration, you may want to use
[other extensions](https://packages.fedoraproject.org/search?query=cockpit-) as
well, such as `cockpit-podman` or `cockpit-networkmanager`.

If you have a custom-built OSTree, simply include the same packages in your build.

These packages are enough when the CoreOS machine is only connected to through another host running Cockpit.

You also need to run a Cockpit web server somewhere, as the "entry point" for browsers. That can
then connect to the local host or any remote machine via ssh to get a Cockpit UI for that machine.

This web server can be deployed as container. It has two modes, which are described below.

## Privileged ws container

Privileged mode provides tight integration with the host: You can use the
host's users and their passwords to log in, and Cockpit's branding will adjust
to the host operating system.

1. Enable password based SSH logins, unless you only use [SSO logins](https://cockpit-project.org/guide/latest/sso.html):
   ```
   echo 'PasswordAuthentication yes' | sudo tee /etc/ssh/sshd_config.d/02-enable-passwords.conf
   sudo systemctl try-restart sshd
   ```

2. Run the Cockpit web service with a privileged container (as root):
   ```
   podman container runlabel --name cockpit-ws RUN quay.io/cockpit/ws
   ```

   You can append additional [cockpit-ws CLI options](https://cockpit-project.org/guide/latest/cockpit-ws.8.html),
   most commonly to change the port:
   ```
   podman container runlabel --name cockpit-ws RUN quay.io/cockpit/ws -- -p 80
   ```

   Run this to show the "RUN" label command if you want to run the container with different arguments:
   ```
   podman container runlabel --display RUN quay.io/cockpit/ws
   ```

3. Make Cockpit start on boot:
   ```
   podman container runlabel INSTALL quay.io/cockpit/ws
   systemctl enable cockpit.service
   ```

Afterward, use a web browser to log into port `9090` on your host IP address as usual.

## Unprivileged bastion container

When you run the container without `--privileged`, it presents an unbranded
login page. The user always has to specify a host name, and it connects to that
host with SSH.

```
podman run -d --name cockpit-bastion -p 9090:9090 quay.io/cockpit/ws
```

This mode is suitable for deploying to e.g. Kubernetes or similar environments
where you cannot have or want privileged containers. In this "bastion host
mode", you can get a Cockpit for servers in your data center without opening an
extra port for cockpit-ws on them.

You can still log into the ws container's host if you specify its *public*
address. [podman](https://podman.io/) provides the special name
`host.containers.internal` for that.

### Configuration

By default, the container uses an internal
[cockpit.conf](https://cockpit-project.org/guide/latest/cockpit.conf.5.html)
which sets `RequireHost = true` and a neutral login title. You can customize
this by passing your own configuration as a volume:

    -v /path/to/your/cockpit.conf:/etc/cockpit/cockpit.conf:ro,Z

Similarly you can also provide a custom `/etc/os-release` to change the
branding.

### SSH authentication

The login page asks the user to confirm unknown SSH host key fingerprints.  You
can mount your known host keys into the container at
`/etc/ssh/ssh_known_hosts`, or set the environment variable
`COCKPIT_SSH_KNOWN_HOSTS_FILE` to specify a different location:

    -v /path/to/known_hosts:/etc/ssh/ssh_known_hosts:ro,Z

You can also mount encrypted private keys inside the container. You can set an environment variable, `COCKPIT_SSH_KEY_PATH_MYHOST`, where `MYHOST` is the uppercased hostname used in the `Connect to` field, and cockpit will use that private key to login for the specified host. Private keys can be set for multiple hosts this way by changing the value of `MYHOST`. You can also set an environment variable, `COCKPIT_SSH_KEY_PATH`, which will be used as a fallback key if no host-specific key is set:

    -e COCKPIT_SSH_KEY_PATH_MYHOST=/.ssh/myhost_id_rsa \
    -e COCKPIT_SSH_KEY_PATH_MYSERVER=/.ssh/myserver_id_rsa \
    -e COCKPIT_SSH_KEY_PATH_192.168.1.1=/.ssh/another_id_rsa \
    -e COCKPIT_SSH_KEY_PATH=/.ssh/id_rsa \
    -v ~/.ssh/:/.ssh:ro,Z

Private keys can be encrypted; then cockpit uses the provided password to decrypt the key.

## More Info

 * [Cockpit Project](https://cockpit-project.org)
 * [Cockpit Development](https://github.com/cockpit-project/cockpit)
 * [cockpit/ws quay.io page](https://quay.io/repository/cockpit/ws)
