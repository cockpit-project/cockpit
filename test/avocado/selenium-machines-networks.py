import os
from avocado import skipIf
from testlib_avocado.seleniumlib import clickable, text_in
from testlib_avocado.machineslib import MachinesLib


class MachinesNetworksTestSuite(MachinesLib):
    """
    :avocado: enable
    :avocado: tags=machines
    """

    @skipIf(os.environ.get("BROWSER") == 'edge', "The second network moved to the first row")
    def testNetworkInfo(self):
        name = "staticvm"
        self.create_vm(name)

        self.click(self.wait_css('#vm-{}-networks'.format(name), cond=clickable))
        self.wait_css('#vm-{}-network-1-type'.format(name))
        self.wait_css('#vm-{}-network-1-type'.format(name), cond=text_in, text_='network')
        self.wait_css('#vm-{}-network-1-source'.format(name), cond=text_in, text_='default')
        self.wait_css('#vm-{}-network-1-state'.format(name), cond=text_in, text_='up')

        # Test add network
        # On MicrosoftEdge, when the second network is added, it will go to the first row, not the second
        # So, the following test will fail when using MicrosoftEdge, drop the test for Edge until find a way to solve.
        self.machine.execute(
            "sudo virsh attach-interface --domain {} --type network --source default --model virtio --mac 52:54:00:4b:73:5f --config --live".format(name))
        self.wait_css('#vm-{}-network-2-type'.format(name))
        self.wait_css('#vm-{}-network-2-type'.format(name), cond=text_in, text_='network')
        self.wait_css('#vm-{}-network-2-model'.format(name), cond=text_in, text_='virtio')
        self.wait_css('#vm-{}-network-2-mac'.format(name), cond=text_in, text_='52:54:00:4b:73:5f')
        self.wait_css('#vm-{}-network-2-source'.format(name), cond=text_in, text_='default')
        self.wait_css('#vm-{}-network-2-state'.format(name), cond=text_in, text_='up')

    def testNetworkPlug(self):
        name = "staticvm"
        self.create_vm(name)

        self.click(self.wait_css('#vm-{}-networks'.format(name), cond=clickable))
        self.wait_css('#vm-{}-network-1-type'.format(name))
        # Unplug
        self.wait_css('.machines-network-actions > button', cond=text_in, text_='Unplug')
        self.click(self.wait_css('.machines-network-actions > button', cond=clickable))
        self.wait_css('#vm-{}-network-1-state'.format(name), cond=text_in, text_='down')
        self.wait_css('.machines-network-actions > button', cond=text_in, text_='Plug')
        self.assertIn('down', self.machine.execute('sudo virsh domif-getlink {} vnet0'.format(name)))
        # Plug
        self.click(self.wait_css('.machines-network-actions > button', cond=clickable))
        self.wait_css('#vm-{}-network-1-state'.format(name), cond=text_in, text_='up')
        self.wait_css('.machines-network-actions > button', cond=text_in, text_='Unplug')
        self.assertIn('up', self.machine.execute('sudo virsh domif-getlink {} vnet0'.format(name)))
