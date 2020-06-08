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

3. Enable password based SSH logins, unless you only use [SSO logins](https://cockpit-project.org/guide/latest/sso.html):
   ```
   echo 'PasswordAuthentication yes' | sudo tee /etc/ssh/sshd_config.d/02-enable-passwords.conf
   sudo systemctl try-restart sshd
   ```

4. Run the Cockpit web service with this privileged container (as root):
   ```
   podman container runlabel --name cockpit-ws RUN cockpit/ws
   ```

5. Make Cockpit start on boot:
   ```
   podman container runlabel INSTALL cockpit/ws
   systemctl enable cockpit.service
   ```

_Steps 3 to 5 are optional if the CoreOS machine will only be connected to from another host running Cockpit._

Afterward, use a web browser to log into port `9090` on your host IP address as usual.

# Cockpit Web Service Container on Atomic

Fedora and Red Hat Enterprise Linux Atomic contains the Cockpit bridge (cockpit-bridge package) and basic pages (cockpit-system package). Thus you can connect from remote Cockpit hosts through ssh without further modification.

These older operating systems use docker instead of podman and have an `atomic` command that wraps it. To start a web service directly on these hosts, run
```
atomic run cockpit/ws
```

## More Info

 * [Cockpit Project](https://cockpit-project.org)
 * [Cockpit Development](https://github.com/cockpit-project/cockpit)
 * [cockpit/ws Docker hub page](https://hub.docker.com/r/cockpit/ws)
