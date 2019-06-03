import os
from avocado import skipIf
from selenium.webdriver.common.action_chains import ActionChains
from testlib_avocado.seleniumlib import clickable, text_in, invisible
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

    def testNetworkEditWithRunning(self):
        name = 'staticvm'
        self.create_vm(name)

        self.click(self.wait_css('#vm-{}-networks'.format(name), cond=clickable))
        self.wait_css('.machines-network-list')
        net_model = self.wait_css('#vm-{}-network-1-model'.format(name)).text

        self.click(self.wait_css('#vm-{}-network-1-edit-dialog'.format(name), cond=clickable))
        self.wait_css('#vm-{}-network-1-edit-dialog-modal-window'.format(name))
        self.select(self.wait_css('#vm-{}-network-1-select-model'.format(name)), "select_by_index", 1)
        self.wait_text('Changes will take effect after shutting down the VM')
        self.click(self.wait_css('#vm-{}-network-1-edit-dialog-save'.format(name), cond=clickable))

        self.wait_dialog_disappear()
        self.wait_css('#vm-{}-network-1-edit-dialog-modal-window'.format(name), cond=invisible)

        self.assertEqual(net_model, self.wait_css('#vm-{}-network-1-model'.format(name)).text, 'Text should not be changed')
        ActionChains(self.driver).move_to_element(self.wait_css('#vm-{}-network-1-model-tooltip'.format(name))).perform()
        self.wait_css('#tip-network', cond=text_in, text_='Changes will take effect after shutting down the VM')
        self.click(self.wait_css('#vm-{}-off-caret'.format(name), cond=clickable))
        self.click(self.wait_css('#vm-{}-forceOff'.format(name), cond=clickable))
        self.wait_css('#vm-{}-network-1-model-tooltip'.format(name), cond=invisible)
        self.assertNotEqual(net_model, self.wait_css('#vm-{}-network-1-model'.format(name)).text, 'Text should be changed')

    def testNetworkEditWithOff(self):
        name = 'staticvm'
        self.create_vm(name, state='shut off')

        self.click(self.wait_css('#vm-{}-networks'.format(name), cond=clickable))
        self.wait_css('.machines-network-list')
        net_model = self.wait_css('#vm-{}-network-1-model'.format(name)).text

        self.click(self.wait_css('#vm-{}-network-1-edit-dialog'.format(name), cond=clickable))
        self.wait_css('#vm-{}-network-1-edit-dialog-modal-window'.format(name))
        self.select(self.wait_css('#vm-{}-network-1-select-model'.format(name)), "select_by_index", 1)
        self.wait_text('Changes will take effect after shutting down the VM', cond=invisible)
        self.click(self.wait_css('#vm-{}-network-1-edit-dialog-save'.format(name), cond=clickable))

        self.wait_dialog_disappear()
        self.wait_css('#vm-{}-network-1-edit-dialog-modal-window'.format(name), cond=invisible)

        self.wait_css('#vm-{}-network-1-model-tooltip'.format(name), cond=invisible)
        self.assertNotEqual(net_model, self.wait_css('#vm-{}-network-1-model'.format(name)).text, 'Text should be changed')
