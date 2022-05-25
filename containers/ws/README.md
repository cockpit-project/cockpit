# Cockpit on Fedora CoreOS or other container hosts

The standard Fedora and Red Hat Enterprise Linux CoreOS images does not contain
Cockpit packages.

1. Install Cockpit packages as overlay RPMs:
   ```
   rpm-ostree install cockpit-system cockpit-ostree cockpit-podman
   ```

   Depending on your configuration, you may want to use
   [other extensions](https://apps.fedoraproject.org/packages/s/cockpit-) as
   well, such as `cockpit-kdump` or `cockpit-networkmanager`.

   If you have a custom-built OSTree, simply include the same packages in your build.

2. Reboot

Steps 1 and 2 are enough when the CoreOS machine is only connected to through another host running Cockpit.

If you want to also run a web server to log in directly on the CoreOS host, you
can use this container in two modes.

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
podman run -d --name cockpit-bastion -p 9090:9090 quay.io/cockit/ws
```

This mode is suitable for deploying to e.g. Kubernetes or similar environments
where you cannot have or want privileged containers. In this "bastion host
mode", you can get a Cockpit for servers in your data center without opening an
extra port for cockpit-ws on them.

You can still log into the ws container's host if you specify its *public*
address. [podman](https://podman.io/) provides the special name
`host.containers.internal` for that.

By default, the container uses an internal
[cockpit.conf](https://cockpit-project.org/guide/latest/cockpit.conf.5.html)
which sets `RequireHost = true` and a neutral login title. You can customize
this by passing your own configuration as a volume:

    -v /path/to/your/cockpit.conf:/etc/cockpit/cockpit.conf:ro,Z

Similarly you can also provide a custom `/etc/os-release` to change the
branding.

## More Info

 * [Cockpit Project](https://cockpit-project.org)
 * [Cockpit Development](https://github.com/cockpit-project/cockpit)
 * [cockpit/ws quay.io page](https://quay.io/repository/cockpit/ws)
