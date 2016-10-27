# Cockpit VM Management
The 'Virtual Management' plugin provides basic overview of host virtualization by listing defined VMs along with their utilization and basic actions.

The source of data is QEMU/Libvirt.

## Nested Virtualization in Vagrant
To play around with nested VMs in Vagrant on a host with enabled nested virtualization [1]:

    $ sudo vagrant up
    $ sudo vagrant ssh

In the vagrant:

    $ sudo virt-host-validate
    $ sudo su
    # systemctl start virtlogd.socket
    # systemctl start libvirtd.service
    # cd /tmp
    # NAME=subVmTest1 && qemu-img create -f qcow2 ${NAME}.img 256M && virt-install -r 128 --pxe --force --nographics --noautoconsole -f ${NAME}.img -n ${NAME}

Log into Cockpit as the 'root' user (pwd 'foobar').

Please note, the created VM is for the plugin testing only, it provides no real OS.
It's purpose is 'just to be listed by libvirt'.

## Links
\[1\] [How to enable nested virtualization in KVM](https://fedoraproject.org/wiki/How_to_enable_nested_virtualization_in_KVM)
