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
The external provider script must create global window.EXTERNAL_PROVIDER object with the following API:

    window.EXTERNAL_PROVIDER = {
        name: 'YOUR PROVIDER NAME',
        init: function (providerContext) {return true;}, // return boolean or Promise

        GET_VM: function ({ lookupId: name }) { return dispatch => {...}; }, // return Promise
        GET_ALL_VMS: function () {},
        SHUTDOWN_VM: function ({ name, id }) {},
        FORCEOFF_VM: function ({ name, id }) {},
        REBOOT_VM: function ({ name, id }) {},
        FORCEREBOOT_VM: function ({ name, id }) {},
        START_VM: function ({ name, id }) {},
        
        vmStateMap, // optional map extending VM states for provider's specifics. Will be merged using Object.assign(), see <StateIcon> component
        
        canReset: function (state) {return true;}, // return boolean
        canShutdown: function (state) {return true;},
        isRunning: function (state) {return true;},
        canRun: function (state) {return true;},
        
        reducer, // optional Redux reducer. If provided, the Redux reducer tree is lazily extended for this new branch (see reducers.es6)  
        
        vmTabRenderers: [ // optional, provider-specific array of subtabs rendered for a VM
            {name: 'Provider-specific subtab', componentFactory: YOUR_COMPONENT_FACTORY}, // see externalComponent.jsx for more info on componentFactory
          ],

        vmDisksActionsFactory: ({ vm }) => [ /* Array of React components for all-disk-wide actions */ ], // optional
        vmDisksColumns: [ // optional extension of columns in the VM's "Disks" subtab
            {title, index, valueProvider: ({ vm, diskTarget }) => {return "String or React Component";}}
          ],
    };

The provider methods are expected to return function `(dispatch) => Promise`.

The `providerContext` passed to the `init()` function as an argument consists of:

    providerContext = {
        defaultProvider, // next provider in the chain (Libvirt)
        React, // React library to be shared between parent code and plugged provider
        reduxStore, // Redux Store object created by parent application, there should be only one per application
        exportedActionCreators, // common redux action creators 
        exportedReactComponents, // exported React components for reuse in the plugged provider
    }
            
Please refer the `libvirt.es6` for the most current API description and more details.

Please refer `cockpit/test/verify/files/cockpitMachinesTestExternalProvider.js` for a "Hello World" implementation in Vanilla JS.

External provider referential implementation is the `cockpit-machines-ovirt-provider` [2] written in ES6 and fully using React/Redux/Webpack.

## Links
\[1\] [How to enable nested virtualization in KVM](https://fedoraproject.org/wiki/How_to_enable_nested_virtualization_in_KVM)
\[2\] [Cockpit-machines oVirt External Provider](https://github.com/oVirt/cockpit-machines-ovirt-provider)

