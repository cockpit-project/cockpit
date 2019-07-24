from testlib_avocado.machineslib import MachinesLib
from testlib_avocado.seleniumlib import clickable, invisible, text_in
from testlib_avocado.timeoutlib import wait


class MachinesNonrootTestSuite(MachinesLib):
    '''
    :avocado: enable
    :avocado: tags=machines
    '''

    def operationsForVm(self, vm_args):
        name = vm_args.get('name')
        log_file = vm_args.get('logfile')

        if log_file and name and 'vnc' in vm_args.get('graphics'):
            self.wait_vm_complete_start(vm_args)
            self.click(self.wait_css('#vm-{}-reboot'.format(name), cond=clickable))
            wait(lambda: self.machine.execute("sudo cat {} | grep 'Sent SIGTERM to all processes' | wc -l".format(log_file)).strip() == '1',
                 delay=3)

            self.wait_vm_complete_start(vm_args)
            self.machine.execute('sudo sh -c "echo > {}"'.format(log_file))
            self.click(self.wait_css('#vm-{}-reboot-caret'.format(name), cond=clickable))
            self.click(self.wait_css('#vm-{}-forceReboot'.format(name), cond=clickable))
            wait(lambda: "Initializing cgroup subsys cpuset" in self.machine.execute("sudo cat {}".format(log_file)),
                 delay=3)

            self.wait_vm_complete_start(vm_args)
            self.click(self.wait_css('#vm-{}-off-caret'.format(name), cond=clickable))
            self.click(self.wait_css('#vm-{}-sendNMI'.format(name), cond=clickable))
            wait(lambda: "NMI received" in self.machine.execute("sudo cat {}".format(log_file)),
                 delay=3)

            self.click(self.wait_css('#vm-{}-off'.format(name), cond=clickable))
            self.wait_css('#vm-{}-off'.format(name), cond=invisible)
            self.wait_css('#vm-{}-run'.format(name))

            self.machine.execute('sudo sh -c "echo > {}"'.format(log_file))
            self.click(self.wait_css('#vm-{}-run'.format(name), cond=clickable))
            self.wait_css('#vm-{}-run'.format(name), cond=invisible)
            self.wait_css('#vm-{}-off'.format(name))

            self.click(self.wait_css('#vm-{}-off-caret'.format(name), cond=clickable))
            self.click(self.wait_css('#vm-{}-forceOff'.format(name), cond=clickable))
            self.wait_css('#vm-{}-off'.format(name), cond=invisible)
            self.wait_css('#vm-{}-run'.format(name))

    def testNonRootOperationWithVm(self):
        name = 'staticvm'
        self.create_vm(name)

        self.machine.execute(
            'sudo useradd auto && echo "auto" | sudo passwd --stdin auto')

        self.mainframe()
        self.click(self.wait_css('#navbar-dropdown', cond=clickable))
        self.click(self.wait_css('#go-logout', cond=clickable))

        self.login('auto', 'auto', authorized=False)
        self.click(self.wait_link('Virtual Machines', cond=clickable))
        self.wait_frame("machines")

        self.assertEqual(
            self.wait_css('#virtual-machines-listing tr td').text,
            'No VM is running or defined on this host')
        self.assertEqual(
            self.wait_css('#app div:nth-child(1) .card-pf-aggregate-status-count').text,
            '0')
        self.assertEqual(
            self.wait_css('#app div:nth-child(2) .card-pf-aggregate-status-count').text,
            '0')

    def testLibvirtUserOperationWithVm(self):
        name = 'staticvm'
        vm_args = self.create_vm(name, graphics='vnc', wait=True)

        self.machine.execute(
            'sudo useradd -G libvirt testlib && echo "testlib" | sudo passwd --stdin testlib')

        self.mainframe()
        self.click(self.wait_css('#navbar-dropdown', cond=clickable))
        self.click(self.wait_css('#go-logout', cond=clickable))

        self.login('testlib', 'testlib', authorized=False)
        self.click(self.wait_link('Virtual Machines', cond=clickable))
        self.wait_frame("machines")

        self.wait_css('#vm-{}-row'.format(name))
        self.click(self.wait_css("tbody tr[data-row-id='vm-{}'] th".format(name), cond=clickable))
        self.wait_css('#vm-{}-memory'.format(name), cond=text_in, text_='256 MiB')
        self.wait_css('#vm-{}-vcpus-count'.format(name), cond=text_in, text_='1')
        self.wait_css('#vm-{}-cputype'.format(name), cond=text_in, text_='custom')
        self.wait_css('#vm-{}-emulatedmachine'.format(name), cond=text_in, text_='pc')
        self.wait_css('#vm-{}-bootorder'.format(name), cond=text_in, text_='disk,network')

        self.click(self.wait_css('#vm-{}-pause'.format(name), cond=clickable))
        self.wait_css('#vm-{}-pause'.format(name), cond=invisible)
        self.click(self.wait_css('#vm-{}-resume'.format(name), cond=clickable))
        self.wait_css('#vm-{}-resume'.format(name), cond=invisible)
        self.click(self.wait_css('#vm-{}-consoles'.format(name), cond=clickable))

        self.operationsForVm(vm_args)

    def testWheelUserOperationWithVm(self):
        name = 'staticvm'
        vm_args = self.create_vm(name, graphics='vnc', wait=True)

        self.machine.execute(
            'sudo useradd -G wheel testwh && echo "testwh" | sudo passwd --stdin testwh')

        self.mainframe()
        self.click(self.wait_css('#navbar-dropdown', cond=clickable))
        self.click(self.wait_css('#go-logout', cond=clickable))

        self.login('testwh', 'testwh', authorized=False)
        self.click(self.wait_link('Virtual Machines', cond=clickable))
        self.wait_frame("machines")

        self.assertEqual(
            self.wait_css('#virtual-machines-listing tr td').text,
            'No VM is running or defined on this host')
        self.assertEqual(
            self.wait_css('#app div:nth-child(1) .card-pf-aggregate-status-count').text,
            '0')
        self.assertEqual(
            self.wait_css('#app div:nth-child(2) .card-pf-aggregate-status-count').text,
            '0')

        self.mainframe()
        self.click(self.wait_css('#navbar-dropdown', cond=clickable))
        self.click(self.wait_css('#go-logout', cond=clickable))
        self.login('testwh', 'testwh')
        self.click(self.wait_link('Virtual Machines', cond=clickable))
        self.wait_frame("machines")

        self.wait_css('#vm-{}-row'.format(name))
        self.click(self.wait_css("tbody tr[data-row-id='vm-{}'] th".format(name), cond=clickable))
        self.wait_css('#vm-{}-memory'.format(name), cond=text_in, text_='256 MiB')
        self.wait_css('#vm-{}-vcpus-count'.format(name), cond=text_in, text_='1')
        self.wait_css('#vm-{}-cputype'.format(name), cond=text_in, text_='custom')
        self.wait_css('#vm-{}-emulatedmachine'.format(name), cond=text_in, text_='pc')
        self.wait_css('#vm-{}-bootorder'.format(name), cond=text_in, text_='disk,network')

        self.click(self.wait_css('#vm-{}-pause'.format(name), cond=clickable))
        self.wait_css('#vm-{}-pause'.format(name), cond=invisible)
        self.click(self.wait_css('#vm-{}-resume'.format(name), cond=clickable))
        self.wait_css('#vm-{}-resume'.format(name), cond=invisible)
        self.click(self.wait_css('#vm-{}-consoles'.format(name), cond=clickable))

        self.operationsForVm(vm_args)
