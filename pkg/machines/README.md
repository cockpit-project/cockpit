Please refer guide/html/feature-virtualmachines.html to general information and how to set up nested virtualization.

With nested virtualization enabled, Vagrant can be used to try pkg/machines:

    $ sudo vagrant up
    $ vagrant ssh

In the vagrant:

    $ sudo virt-host-validate
    $ sudo su
    # systemctl start virtlogd.socket
    # systemctl start libvirtd.service
    # cd /tmp
    # NAME=subVmTest1 &amp;&amp; qemu-img create -f qcow2 ${NAME}.img 256M &amp; &amp; \
        virt-install -r 128 --pxe --force --nographics --noautoconsole \
        -f ${NAME}.img -n ${NAME}   # to create and start a dummy VM

Log into Cockpit as the 'root' user (pwd 'foobar') and follow `Virtual Machines` from the left-side menu.


Please note, the created VM is for the plugin testing only, it provides no real OS.
It's purpose is "just to be listed by libvirt".
