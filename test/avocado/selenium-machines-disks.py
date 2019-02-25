from testlib_avocado.seleniumlib import clickable, text_in
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
        self.wait_css('#vm-{}-disks-hda-device'.format(name), cond=text_in, text_='disk')
        self.wait_css('#vm-{}-disks-hda-bus'.format(name), cond=text_in, text_='ide')
        self.wait_css('#vm-{}-disks-hda-source .machines-disks-source-value'.format(name),
                      cond=text_in, text_='{}'.format(args.get('image')))
        self.wait_css('#vm-{}-disks-hda-used'.format(name), cond=text_in, text_='0.02')
        self.wait_css('#vm-{}-disks-hda-capacity'.format(name), cond=text_in, text_='0.04')
