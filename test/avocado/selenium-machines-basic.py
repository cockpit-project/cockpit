import os
import re
import time
from avocado import skipIf
from testlib_avocado.timeoutlib import wait
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

        self.wait_css('#vm-{}-memory'.format(name), cond=text_in, text_='256 MiB')
        self.wait_css('#vm-{}-vcpus-count'.format(name), cond=text_in, text_='1')
        self.wait_css('#vm-{}-cputype'.format(name), cond=text_in, text_='custom')
        self.wait_css('#vm-{}-emulatedmachine'.format(name), cond=text_in, text_='pc')
        self.wait_css('#vm-{}-bootorder'.format(name), cond=text_in, text_='disk,network')

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

    @skipIf(os.environ.get('HUB') == '10.111.112.10', "Doesn't work when using run-tests")
    def testForceRestartVm(self):
        name = "staticvm"
        args = self.create_vm(name, wait=True)

        self.click(self.wait_css('#vm-{}-reboot-caret'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-forceReboot'.format(name), cond=clickable))
        wait(lambda: re.search("login:.*Initializing cgroup",
                               self.machine.execute("sudo cat {0}".format(args.get('logfile')))), delay=3)
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
        self.machine.execute("sudo virsh attach-disk {} {} vda".format(name, imgdel))
        self.click(self.wait_css('#vm-{}-disks'.format(name), cond=clickable))
        self.wait_css('#vm-{}-disks-vda-bus'.format(name))

        self.click(self.wait_css("#vm-{}-delete".format(name), cond=clickable))
        self.click(self.wait_css("#vm-{}-delete-modal-dialog li:nth-of-type(1) input".format(name), cond=clickable))
        self.click(self.wait_css("#vm-{}-delete-modal-dialog button.btn-danger".format(name), cond=clickable))
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

    @skipIf(os.environ.get('HUB') == '10.111.112.10', "It may cause some problem when use 'run-test'")
    def testCreate20VMs(self):
        iso_source = '/home/{}.iso'.format('test' + str(time.time()).split('.')[0])
        self.machine.execute('sudo touch {}'.format(iso_source))

        for i in range(20):
            self.create_vm_by_ui(
                connection='session', name='test{}'.format(i), source=iso_source, mem_unit='M', storage=1, storage_unit='M')
            self.vm_stop_list.append('test{}'.format(i))

    def testCreateVMWithISO(self):
        name = 'test_iso'
        iso = '/home/{}.iso'.format(name + str(time.time()).split('.')[0])

        self.machine.execute('sudo touch {}'.format(iso))

        self.create_vm_by_ui(connection='session', name=name, source=iso, mem_unit='M', storage_unit='M')
        self.vm_stop_list.append(name)

    @skipIf(os.environ.get('URLSOURCE') is None, "The environment variable which is URLSOURCE is needed")
    def testCreateVMWithUrl(self):
        name = 'test_url'

        self.create_vm_by_ui(
            connection='session', name=name, source_type='url', source=os.environ.get('URLSOURCE'), immediately_start=True)

        self.wait_css('#vm-{}-row'.format(name))
        self.wait_css('#vm-{}-state'.format(name), cond=text_in, text_='creating VM installation')
        self.wait_css('#vm-{}-state'.format(name), cond=text_in, text_='running')
        self.wait_css('div.toolbar-pf-results canvas')

        self.vm_stop_list.append(name)
