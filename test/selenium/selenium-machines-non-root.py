from testlib_avocado.machineslib import MachinesLib


class MachinesNonrootTestSuite(MachinesLib):
    '''
    :avocado: enable
    :avocado: tags=machines
    '''

    def testNonRootOperationWithVm(self):
        name = 'staticvm'
        self.create_vm(name)

        self.non_root_user_operations()

    def testLibvirtUserOperationWithVm(self):
        name = 'staticvm'
        vm_args = self.create_vm(name, wait=True)

        self.non_root_user_operations('libvirt', True, vm_args)

    def testWheelUserOperationWithVm(self):
        name = 'staticvm'
        vm_args = self.create_vm(name, wait=True)

        self.non_root_user_operations('wheel')
        self.non_root_user_operations('wheel', True, vm_args, True)
