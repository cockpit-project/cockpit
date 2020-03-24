from testlib_avocado.machineslib import MachinesLib


class MachinesNonrootTestSuite(MachinesLib):
    '''
    :avocado: enable
    :avocado: tags=machines
    '''

    def testNonRootOperationWithVm(self):
        name = 'staticvm'
        self.create_vm(name, wait=True)

        # A regular user without any extra groups and without
        # escalated privileges wont see any VM and can't do any
        # operation on it.

        self.non_root_user_operations(user_group=None, privilege=False,
                                      operations=False)

    def testLibvirtUserOperationWithVm(self):
        name = 'staticvm'
        vm_args = self.create_vm(name, wait=True)

        # A regular user in the libvirt group is allowed to see the VM
        # and can do operations on it, even without escalated
        # privileges.

        self.non_root_user_operations(user_group='libvirt', privilege=False,
                                      operations=True, vm_args=vm_args)

    def testWheelUserOperationWithVm(self):
        name = 'staticvm'
        vm_args = self.create_vm(name, wait=True)

        # A admin user in the wheel group is allowed to see the VM and
        # can do operations on it, but only with escalated privileges.

        self.non_root_user_operations(user_group='wheel', privilege=False,
                                      operations=False)

        self.non_root_user_operations(user_group='wheel', privilege=True,
                                      operations=True, vm_args=vm_args)
