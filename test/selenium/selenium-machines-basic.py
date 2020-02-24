import os
import re
from avocado import skipIf
from testlib_avocado.timeoutlib import wait
from testlib_avocado.timeoutlib import TimeoutError
from testlib_avocado.seleniumlib import clickable, invisible, text_in
from testlib_avocado.machineslib import MachinesLib


class MachinesBasicTestSuite(MachinesLib):
    """
    :avocado: enable
    :avocado: tags=machines
    """

    def testNoVm(self):
        self.wait_text("No VM is running or defined on this host")

    def testOverviewInfo(self):
        name = "staticvm"
        self.create_vm(name)

        self.check_vm_info(name)

    def testRunVm(self):
        name = "staticvm"
        args = self.create_vm(name, state='shut off')

        self.click(self.wait_css('#vm-{}-run'.format(name), cond=clickable))
        self.wait_css('#vm-{}-state'.format(name), cond=text_in, text_='running')
        self.wait_css('#vm-{}-run'.format(name), cond=invisible)
        self.wait_css('#vm-{}-reboot'.format(name))
        self.wait_css('#vm-{}-off'.format(name))
        self.wait_css('#vm-{}-delete'.format(name))
        self.wait_vm_complete_start(args)

    def testRestartVm(self):
        name = "staticvm"
        args = self.create_vm(name, wait=True)

        self.click(self.wait_css('#vm-{}-reboot'.format(name), cond=clickable))
        wait(lambda: "reboot: Power down" in self.machine.execute("sudo cat {0}".format(args.get('logfile'))), delay=3)
        self.wait_css('#vm-{}-state'.format(name), cond=text_in, text_='running')

    def testForceRestartVm(self):
        name = "staticvm"
        args = self.create_vm(name, wait=True)

        def force_reboot_operation():
            self.click(self.wait_css('#vm-{}-reboot-caret'.format(name), cond=clickable))
            self.click(self.wait_css('#vm-{}-forceReboot'.format(name), cond=clickable))
            wait(lambda: re.search("login:.*Initializing cgroup",
                                   self.machine.execute("sudo cat {0}".format(args.get('logfile')))))

        # Retry when running in edge
        # because the first operations will not take effect in some edge browser
        # The error will be throw if timeout at the second time
        try:
            force_reboot_operation()
        except TimeoutError:
            force_reboot_operation()

        self.wait_css('#vm-{}-state'.format(name), cond=text_in, text_='running')

    def testShutdownVm(self):
        name = "staticvm"
        args = self.create_vm(name, wait=True)

        self.click(self.wait_css('#vm-{}-off'.format(name), cond=clickable))
        self.wait_css('#vm-{}-state'.format(name), cond=text_in, text_='shut off')
        wait(lambda: "reboot: Power down" in self.machine.execute("sudo cat {0}".format(args.get('logfile'))), delay=3)
        self.wait_css('#vm-{}-run'.format(name))
        self.click(self.wait_css('#vm-{}-consoles'.format(name), cond=clickable))
        self.wait_text("Please start the virtual machine to access its console.", element="div")

    def testForceShutdownVm(self):
        name = "staticvm"
        self.create_vm(name, wait=True)

        self.click(self.wait_css('#vm-{}-off-caret'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-forceOff'.format(name), cond=clickable))
        self.wait_css('#vm-{}-state'.format(name), cond=text_in, text_='shut off')
        self.wait_css('#vm-{}-run'.format(name))
        self.click(self.wait_css('#vm-{}-consoles'.format(name), cond=clickable))
        self.wait_text("Please start the virtual machine to access its console.", element="div")

    def testSendNMI(self):
        name = "staticvm"
        args = self.create_vm(name, wait=True)

        self.click(self.wait_css('#vm-{}-off-caret'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-sendNMI'.format(name), cond=clickable))
        wait(lambda: "NMI received" in self.machine.execute("sudo cat {0}".format(args.get('logfile'))), delay=3)
        self.wait_css('#vm-{}-state'.format(name), cond=text_in, text_='running')

    def testDelete(self):
        name = "staticvm"
        args = self.create_vm(name, wait=True)

        imgdel = "{}/imagetest.img".format(args.get('poolPath'))
        self.machine.execute(
            "sudo qemu-img create -f raw {} 128M && sudo virsh pool-refresh {}".format(imgdel, args.get('poolName')))
        self.machine.execute("sudo virsh attach-disk {} {} vdb".format(name, imgdel))
        self.click(self.wait_css('#vm-{}-disks'.format(name), cond=clickable))
        self.wait_css('#vm-{}-disks-vdb-bus'.format(name))

        self.click(self.wait_css("#vm-{}-delete".format(name), cond=clickable))
        self.click(self.wait_css("#vm-{}-delete-modal-dialog li:nth-of-type(1) input".format(name), cond=clickable))
        self.click(self.wait_css("#vm-{}-delete-modal-dialog button.pf-m-danger".format(name), cond=clickable))
        self.wait_css("#vm-{}-row".format(name), cond=invisible)

        self.machine.execute("while test -f {}; do sleep 1; done".format(imgdel))
        self.assertNotIn(name, self.machine.execute("sudo virsh list --all"))
        self.assertNotIn(imgdel, self.machine.execute("sudo virsh vol-list {}".format(args.get('poolName'))))
        self.assertIn(args.get('image'), self.machine.execute("sudo virsh vol-list {}".format(args.get('poolName'))))

    def testVmStatus(self):
        name = 'staticvm'
        self.create_vm(name)

        self.assertEqual(
            self.machine.execute('sudo virsh domstate {}'.format(name)).rstrip(),
            self.wait_css('#vm-{}-state'.format(name)).text)

    def testCreateVMWithISO(self):
        name = 'test_iso'
        iso_path = '/home/{}.iso'.format(name + MachinesLib.random_string())
        self.vm_stop_list.append(name)

        self.machine.execute('sudo touch {}'.format(iso_path))

        self.create_vm_by_ui(connection='session',
                             name=name,
                             source=iso_path,
                             mem=128,
                             mem_unit='M',
                             storage=50,
                             storage_unit='M')

    @skipIf(os.environ.get('URLSOURCE') is None,
            "Need an environment variable named 'URLSOURCE'")
    def testCreateVMWithUrl(self):
        name = 'test_url'
        self.vm_stop_list.append(name)

        self.create_vm_by_ui(connection='session',
                             name=name,
                             source_type='url',
                             source=os.environ.get('URLSOURCE'),
                             immediately_start=True)

        self.wait_css('#vm-{}-state'.format(name), cond=text_in, text_='running')
        self.wait_css('div.toolbar-pf-results canvas')
