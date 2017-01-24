# Cockpit VM Management
The 'Virtual Management' plugin provides basic overview of host virtualization by listing defined VMs along with their utilization and basic actions.

The default datasource is QEMU/Libvirt.

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

## External Providers
By default, the plugin is based on Libvirt, accessed via `virsh`.

The provider can be replaced by deploying `provider/index.js` into the machines installation directory, like

    /usr/share/cockpit/machines/provider/index.js

This script will be dynamically loaded and executed.
The external provider script must create global window.EXTERNAL_PROVIDER object with following API:

    window.EXTERNAL_PROVIDER = {
        name: 'YOUR PROVIDER NAME',
        init: function (actionCreators, nextProvider) {return true;},

        GET_VM: function ({ lookupId: name }) { return dispatch => {...}; },
        GET_ALL_VMS: function () {},
        SHUTDOWN_VM: function ({ name, id }) {},
        FORCEOFF_VM: function ({ name, id }) {},
        REBOOT_VM: function ({ name, id }) {},
        FORCEREBOOT_VM: function ({ name, id }) {},
        START_VM: function ({ name, id }) {},
        
        canReset: function (state) {return true;},
        canShutdown: function (state) {return true;},
        isRunning: function (state) {return true;},
        canRun: function (state) {return true;},
        };

The provider methods are expected to return a Promise.

Please refer libvirt.es6 for current API and more details.

Referential implementation of an external provider is the cockpit-machines-ovirt-provider [2]

## Links
\[1\] [How to enable nested virtualization in KVM](https://fedoraproject.org/wiki/How_to_enable_nested_virtualization_in_KVM)
\[2\] [Cockpit-machines oVirt External Provider](https://github.com/mareklibra/cockpit-machines-ovirt-provider)

