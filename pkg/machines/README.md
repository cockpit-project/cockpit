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

The code here can be reused to interact with VMs from other non-libvirt sources.
This code is registered as an NPM module called ```cockpit-machines-base```. In
your out of tree code, include ```cockpit-machines-base``` as a dependency,
and use webpack or browserify to build a complete component.

Call provider.es6 setVirtProvider with your provider as an argument:

    provider.setVirtProvider(MyProvider);

Your provider should have the following properties and methods:

    MyProvider = {
        name: 'YOUR PROVIDER NAME',
        init: function (providerContext) {return true;}, // return boolean or Promise

        GET_VM: function ({ lookupId: name }) { return dispatch => {...}; }, // return Promise
        GET_ALL_VMS: function () {},
        SHUTDOWN_VM: function ({ name, id }) {},
        FORCEOFF_VM: function ({ name, id }) {},
        REBOOT_VM: function ({ name, id }) {},
        FORCEREBOOT_VM: function ({ name, id }) {},
        START_VM: function ({ name, id }) {},
        DELETE_VM: function ({ name, id, options }) {},

        // options to DELETE_VM:
        // - 'destroy' (bool) force-off the machine before deletion when true
        // - 'storage' (array of string) also delete listed volumes (string is target)

        vmStateMap, // optional map extending VM states for provider's specifics. Will be merged using Object.assign(), see <StateIcon> component

        canReset: function (state) {return true;}, // return boolean
        canShutdown: function (state) {return true;},
        canDelete: function (state) {return true;},
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
        React, // React library to be shared between parent code and plugged provider
        reduxStore, // Redux Store object created by parent application, there should be only one per application
        exportedActionCreators, // common redux action creators
        exportedReactComponents, // exported React components for reuse in the plugged provider
    }

Please refer the `libvirt.es6` for the most current API description and more details.

External provider referential implementation is the `cockpit-machines-ovirt-provider` [2] written in ES6 and fully using React/Redux/Webpack.

## Links
\[1\] [How to enable nested virtualization in KVM](https://fedoraproject.org/wiki/How_to_enable_nested_virtualization_in_KVM)
\[2\] [Cockpit-machines oVirt External Provider](https://github.com/oVirt/cockpit-machines-ovirt-provider)
