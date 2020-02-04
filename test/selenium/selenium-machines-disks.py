from testlib_avocado.seleniumlib import clickable, invisible, text_in
from testlib_avocado.machineslib import MachinesLib


class MachinesDisksTestSuite(MachinesLib):
    """
    :avocado: enable
    :avocado: tags=machines
    """

    def testDiskInfo(self):
        name = "staticvm"
        args = self.create_vm(name)

        self.click(self.wait_css('#vm-{}-disks'.format(name), cond=clickable))
        self.wait_css('#vm-{}-disks-vda-device'.format(name), cond=text_in, text_='disk')
        self.wait_css('#vm-{}-disks-vda-bus'.format(name), cond=text_in, text_='virtio')
        self.wait_css('#vm-{}-disks-vda-source-file'.format(name),
                      cond=text_in, text_='{}'.format(args.get('image')))
        self.wait_css('#vm-{}-disks-vda-used'.format(name), cond=text_in, text_='0.02')
        self.wait_css('#vm-{}-disks-vda-capacity'.format(name), cond=text_in, text_='0.04')

    def testAddDiskWithVmOff(self):
        name = "staticvm"
        self.create_vm(name, state='shut off')
        pool = self.prepare_disk('test')

        self.click(self.wait_css('#vm-{}-disks'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk'.format(name), cond=clickable))
        self.select_by_value(self.wait_css('#vm-{}-disks-adddisk-new-select-pool'.format(name)), pool[1])
        self.send_keys(self.wait_css('#vm-{}-disks-adddisk-new-name'.format(name)), 'qcow2disk_' + MachinesLib.random_string())
        self.click(self.wait_css('#vm-{}-disks-adddisk-dialog-add'.format(name), cond=clickable))
        self.wait_dialog_disappear()
        self.wait_css('#vm-{}-disks-vdb-device'.format(name))

        self.click(self.wait_css('#vm-{}-disks-adddisk'.format(name), cond=clickable))
        self.select_by_value(self.wait_css('#vm-{}-disks-adddisk-new-select-pool'.format(name)), pool[2])
        self.send_keys(self.wait_css('#vm-{}-disks-adddisk-new-name'.format(name)), 'raw2disk_' + MachinesLib.random_string())
        self.select_by_value(self.wait_css('#vm-{}-disks-adddisk-new-format'.format(name)), 'raw')
        self.click(self.wait_css('#vm-{}-disks-adddisk-dialog-add'.format(name), cond=clickable))
        self.wait_dialog_disappear()
        self.wait_css('#vm-{}-disks-vdc-device'.format(name))

        self.click(self.wait_css('#vm-{}-disks-adddisk'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-useexisting'.format(name), cond=clickable))
        self.select_by_value(self.wait_css('#vm-{}-disks-adddisk-existing-select-pool'.format(name)), pool[1])
        self.click(self.wait_css('#vm-{}-disks-adddisk-dialog-add'.format(name, cond=clickable)))
        self.wait_dialog_disappear()
        self.wait_css('#vm-{}-disks-vdd-device'.format(name))

        self.click(self.wait_css('#vm-{}-disks-adddisk'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-useexisting'.format(name), cond=clickable))
        self.select_by_value(self.wait_css('#vm-{}-disks-adddisk-existing-select-pool'.format(name)), pool[2])
        self.select_by_value(self.wait_css('#vm-{}-disks-adddisk-existing-select-volume'.format(name)), pool[0][pool[2]][1])
        self.click(self.wait_css('#vm-{}-disks-adddisk-dialog-add'.format(name, cond=clickable)))
        self.wait_dialog_disappear()
        self.wait_css('#vm-{}-disks-vde-device'.format(name))

        self.click(self.wait_css('#vm-{}-run'.format(name), cond=clickable))
        self.wait_css('#vm-{}-run'.format(name), cond=invisible)

        self.assertEqual(self.machine.execute("sudo virsh list --all | grep staticvm | awk '{print $3}' ORS=''"), 'running')
        self.assertEqual(self.machine.execute(
            'sudo virsh domblklist ' + name + ' | awk \'NR>=3{if($0!="")print}\' | wc -l').strip(), '5')

    def testAddDiskWithVmOn(self):
        name = "staticvm"
        self.create_vm(name, wait=True)
        pool = self.prepare_disk('test')

        self.click(self.wait_css('#vm-{}-disks'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk'.format(name), cond=clickable))
        self.select_by_value(self.wait_css('#vm-{}-disks-adddisk-new-select-pool'.format(name)), pool[2])
        self.send_keys(self.wait_css('#vm-{}-disks-adddisk-new-name'.format(name)), 'qcow2disk_' + MachinesLib.random_string())
        self.check_box(self.wait_css('#vm-{}-disks-adddisk-permanent'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-dialog-add'.format(name), cond=clickable))
        self.wait_dialog_disappear()
        self.wait_css('#vm-{}-disks-vdb-device'.format(name))

        self.click(self.wait_css('#vm-{}-disks-adddisk'.format(name), cond=clickable))
        self.select_by_value(self.wait_css('#vm-{}-disks-adddisk-new-select-pool'.format(name)), pool[1])
        self.send_keys(self.wait_css('#vm-{}-disks-adddisk-new-name'.format(name)), 'raw2disk_' + MachinesLib.random_string())
        self.select_by_value(self.wait_css('#vm-{}-disks-adddisk-new-format'.format(name)), 'raw')
        self.click(self.wait_css('#vm-{}-disks-adddisk-dialog-add'.format(name), cond=clickable))
        self.wait_dialog_disappear()
        self.wait_css('#vm-{}-disks-vdc-device'.format(name))

        self.click(self.wait_css('#vm-{}-disks-adddisk'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-useexisting'.format(name), cond=clickable))
        self.select_by_value(self.wait_css('#vm-{}-disks-adddisk-existing-select-pool'.format(name)), pool[1])
        self.click(self.wait_css('#vm-{}-disks-adddisk-dialog-add'.format(name, cond=clickable)))
        self.wait_dialog_disappear()
        self.wait_css('#vm-{}-disks-vdd-device'.format(name))

        self.click(self.wait_css('#vm-{}-disks-adddisk'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-useexisting'.format(name), cond=clickable))
        self.select_by_value(self.wait_css('#vm-{}-disks-adddisk-existing-select-pool'.format(name)), pool[2])
        self.select_by_value(self.wait_css('#vm-{}-disks-adddisk-existing-select-volume'.format(name)), pool[0][pool[2]][1])
        self.check_box(self.wait_css('#vm-{}-disks-adddisk-permanent'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk-dialog-add'.format(name, cond=clickable)))
        self.wait_dialog_disappear()
        self.wait_css('#vm-{}-disks-vde-device'.format(name))

        self.click(self.wait_css('#vm-{}-off'.format(name), cond=clickable))
        self.wait_css('#vm-{}-off'.format(name), cond=invisible)

        self.assertEqual(self.machine.execute("sudo virsh list --all | grep " + name + " | awk '{print $3}' ORS=''"), 'shut')
        self.assertEqual(self.machine.execute(
            'sudo virsh domblklist ' + name + ' | awk \'NR>=3{if($0!="")print}\' | wc -l').strip(), '3')

    def testDetachDiskVmOn(self):
        name = "staticvm"
        self.create_vm(name, wait=True)

        self.click(self.wait_css('#vm-{}-disks'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk'.format(name), cond=clickable))
        self.select_by_value(self.wait_css('#vm-{}-disks-adddisk-new-select-pool'.format(name)), 'default')
        self.send_keys(self.wait_css('#vm-{}-disks-adddisk-new-name'.format(name)), 'detachdisk_vm_on_' + MachinesLib.random_string())
        self.click(self.wait_css('#vm-{}-disks-adddisk-dialog-add'.format(name), cond=clickable))
        self.wait_css('#vm-{}-disks-vdb-device'.format(name))
        self.click(self.wait_css('#delete-{}-disk-vdb'.format(name), cond=clickable))
        self.click(self.wait_css('.modal-footer button.btn-danger'.format(name), cond=clickable))
        self.wait_css('vm-{}-disks-vdb-device'.format(name), cond=invisible)
        self.click(self.wait_css('#vm-{}-off'.format(name), cond=clickable))
        self.wait_css('#vm-{}-off'.format(name), cond=invisible)
        self.click(self.wait_css('#vm-{}-run'.format(name), cond=clickable))
        self.wait_css('#vm-{}-run'.format(name), cond=invisible)
        self.wait_css('#vm-{}-disks-vdb-device'.format(name), cond=invisible)

        self.assertEqual(self.machine.execute('sudo virsh domblklist ' + name + ' | awk \'NR>=3{if($0!="")print}\' | wc -l').strip(), '1')

    def testDetachDiskVmOff(self):
        name = "staticvm"
        self.create_vm(name, state='shut off')

        self.click(self.wait_css('#vm-{}-disks'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-disks-adddisk'.format(name), cond=clickable))
        self.select_by_value(self.wait_css('#vm-{}-disks-adddisk-new-select-pool'.format(name)), 'default')
        self.send_keys(self.wait_css('#vm-{}-disks-adddisk-new-name'.format(name)), 'detachdisk_vm_off_' + MachinesLib.random_string())
        self.click(self.wait_css('#vm-{}-disks-adddisk-dialog-add'.format(name), cond=clickable))
        self.wait_css('#vm-{}-disks-vdb-device'.format(name))
        self.click(self.wait_css('#delete-{}-disk-vdb'.format(name), cond=clickable))
        self.click(self.wait_css('.modal-footer button.btn-danger'.format(name), cond=clickable))
        self.wait_css('#vm-{}-disks-vdb-device'.format(name), cond=invisible)
        self.click(self.wait_css('#vm-{}-run'.format(name), cond=clickable))
        self.wait_css('#vm-{}-run'.format(name), cond=invisible)
        self.wait_css('#vm-{}-disks-vdb-device'.format(name), cond=invisible)

        self.assertEqual(self.machine.execute('sudo virsh domblklist ' + name + ' | awk \'NR>=3{if($0!="")print}\' | wc -l').strip(), '1')
