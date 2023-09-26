# Changing cockpit's SELinux policy

The clean way is to edit the policy files and then rebuild the rpms and image with
`test/image-prepare -q fedora-XX`.

To iterate more quickly, locally `./configure` the build tree with
`--enable-selinux-policy=targeted`, then you can quickly recompile and install
the policy into the `c` SSH target with:
```sh
make cockpit.pp && scp cockpit.pp c:/tmp/ && ssh c semodule -i /tmp/cockpit.pp
```
