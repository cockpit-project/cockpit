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

If you want to also run a web server to log in directly on the CoreOS host:

3. Enable password based SSH logins, unless you only use [SSO logins](https://cockpit-project.org/guide/latest/sso.html):
   ```
   echo 'PasswordAuthentication yes' | sudo tee /etc/ssh/sshd_config.d/02-enable-passwords.conf
   sudo systemctl try-restart sshd
   ```

4. Run the Cockpit web service with a privileged container (as root):
   ```
   podman container runlabel --name cockpit-ws RUN quay.io/cockpit/ws
   ```

5. Make Cockpit start on boot:
   ```
   podman container runlabel INSTALL quay.io/cockpit/ws
   systemctl enable cockpit.service
   ```

Afterward, use a web browser to log into port `9090` on your host IP address as usual.

## More Info

 * [Cockpit Project](https://cockpit-project.org)
 * [Cockpit Development](https://github.com/cockpit-project/cockpit)
 * [cockpit/ws quay.io page](https://quay.io/repository/cockpit/ws)
