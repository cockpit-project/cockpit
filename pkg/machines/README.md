# Cockpit VM Management
TODO: Brief plugin desciption

## Nested Virtualization in Vagrant
To play around with nested VMs, try when vagrant is up: 
$ sudo vagrant ssh

In the vagrant:
$ sudo su
$ cd /tmp
$ NAME=subVmTest1 && qemu-img create -f qcow2 ${NAME}.img 256M && virt-install -r 128 --pxe --force --nographics --noautoconsole -f ${NAME}.img -n ${NAME}

Log into Cockpit as the 'root' user (pwd 'foobar').

Please note, the created VM is for vms plugin testing only, it provides no real OS. It's purpose is 'just to be listed by the libvirt'.
