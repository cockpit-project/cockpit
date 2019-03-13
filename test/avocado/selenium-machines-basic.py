import os
import re
import xml.etree.ElementTree as ET
from avocado import skipIf
from testlib_avocado.timeoutlib import wait
from testlib_avocado.seleniumlib import clickable, invisible, text_in, visible
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
        self.click(self.wait_css("#vm-{}-delete-modal-dialog tbody tr:nth-of-type(1) input".format(name), cond=clickable))
        self.click(self.wait_css("#vm-{}-delete-modal-dialog button.btn-danger".format(name), cond=clickable))
        self.wait_css("#vm-{}-row".format(name), cond=invisible)

        self.machine.execute("while test -f {}; do sleep 1; done".format(imgdel))
        self.assertNotIn(name, self.machine.execute("sudo virsh list --all"))
        self.assertNotIn(imgdel, self.machine.execute("sudo virsh vol-list {}".format(args.get('poolName'))))
        self.assertIn(args.get('image'), self.machine.execute("sudo virsh vol-list {}".format(args.get('poolName'))))

    def testVmStatus(self):
        self.create_vm()

        self.assertEqual(
            self.machine.execute('virsh domstate staticvm').replace("\n",""),
            self.wait_css('#vm-staticvm-state').text)

    # def testOverviewInfo(self):
    #     self.create_vm()

    #     mem_ui = self.wait_css('#vm-staticvm-memory', cond=visible).text
    #     vcpu_ui = self.wait_css('#vm-staticvm-vcpus', cond=visible).text
    #     cpu_type_ui = self.wait_css('#vm-staticvm-cputype', cond=visible).text
    #     emulatedmachine_ui = self.wait_css('#vm-staticvm-emulatedmachine', cond=visible).text
    #     boot_ui = self.wait_css('#vm-staticvm-bootorder', cond=visible).text
    #     autostart_ui = self.wait_css('#vm-staticvm-autostart', cond=visible).text

    #     xml_for_vm = ET.fromstring(self.machine.execute('virsh dumpxml staticvm'))
    #     mem = str(int(xml_for_vm.find('.//memory').text) // 1024) + ' MiB'
    #     vcpu_count = xml_for_vm.find('.//vcpu').text
    #     cpu_type = xml_for_vm.find('.//cpu').attrib['mode'] + ' (' + xml_for_vm.find('.//cpu/model').text + ')'
    #     emulatedmachine = xml_for_vm.find('.//os/type').attrib['machine']
    #     boot = xml_for_vm.find('.//os/boot').attrib['dev']
    #     autostart = self.machine.execute('virsh dominfo staticvm | grep -i autostart').split(" ")[-1].replace("\n","d")

    #     self.assertEqual(mem, mem_ui)
    #     self.assertEqual(vcpu_count, vcpu_ui)
    #     self.assertEqual(cpu_type, cpu_type_ui)
    #     self.assertEqual(emulatedmachine, emulatedmachine_ui)
    #     self.assertTrue(('disk' if boot == 'hd' else 'unknown') in boot_ui)
    #     self.assertEqual(autostart, autostart_ui)

    def testCreate20Machines(self):
        for i in range(0, 20):
            self.create_vm_on_ui('testVM{}'.format(i))

    def testDelVmWithStorage(self):
        args = self.create_vm()

        pool_path = args.get('poolPath',None)
        if not pool_path:
            self.log.error('no poolPath')
        base_img = pool_path + '/cirros.qcow2'
        back_img = pool_path + '/backup.qcow2'
        attach_img = pool_path + '/attach.qcow2'
        self.machine.execute('sudo cp {} {}'.format(base_img,back_img))

        self.machine.execute(
            'sudo qemu-img create -f raw {} 128M && sudo virsh pool-refresh {}'.format(attach_img, args.get('poolName')))
        self.machine.execute("sudo virsh attach-disk {} {} vda".format('staticvm',attach_img))

        self.click(self.wait_css('#vm-staticvm-disks', cond=clickable))
        self.wait_css('#vm-staticvm-disks-vda-bus')

        self.click(self.wait_css('#vm-staticvm-delete', cond=clickable))
        self.click(self.wait_css("#vm-staticvm-delete-modal-dialog button.btn-danger", cond=clickable))

        self.wait_dialog_disappear()
        self.wait_css('#vm-staticvm-row', cond=invisible)
        self.assertNotIn('staticvm', self.machine.execute('sudo virsh list --all'))
        self.assertNotIn(args.get('image',None), self.machine.execute('sudo virsh vol-list default'))
        self.assertNotIn(attach_img, self.machine.execute('sudo virsh vol-list default'))

        self.machine.execute('sudo mv {} {}'.format(back_img,base_img))



