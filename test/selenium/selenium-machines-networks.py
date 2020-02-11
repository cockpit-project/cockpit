from selenium.webdriver.common.action_chains import ActionChains
from testlib_avocado.seleniumlib import clickable, text_in, invisible
from testlib_avocado.machineslib import MachinesLib


class MachinesNetworksTestSuite(MachinesLib):
    """
    :avocado: enable
    :avocado: tags=machines
    """

    def testNetworkInfo(self):
        name = "staticvm"
        self.create_vm(name)

        net_info = self.machine.execute('sudo virsh domiflist %s | awk \'NR>=3{if($0!="")print}\'' % name).split()
        net_state = self.machine.execute('sudo virsh domif-getlink {} {}'.format(name, net_info[0])).split()[1]

        self.click(self.wait_css('#vm-{}-networks'.format(name),
                                 cond=clickable))
        self.wait_css('#vm-{}-network-1-type'.format(name),
                      cond=text_in,
                      text_=net_info[1])
        self.wait_css('#vm-{}-network-1-model'.format(name),
                      cond=text_in,
                      text_=net_info[3])
        self.wait_css('#vm-{}-network-1-source'.format(name),
                      cond=text_in,
                      text_=net_info[2])
        self.wait_css('#vm-{}-network-1-mac'.format(name),
                      cond=text_in,
                      text_=net_info[4])
        self.wait_css('#vm-{}-network-1-state'.format(name),
                      cond=text_in,
                      text_=net_state)

    def testNetworkPlug(self):
        name = "staticvm"
        self.create_vm(name)

        self.click(self.wait_css('#vm-{}-networks'.format(name), cond=clickable))
        self.wait_css('#vm-{}-network-1-type'.format(name))
        # Unplug
        self.wait_css('.machines-listing-actions > button', cond=text_in, text_='Unplug')
        self.click(self.wait_css('.machines-listing-actions > button', cond=clickable))
        self.wait_css('#vm-{}-network-1-state'.format(name), cond=text_in, text_='down')
        self.wait_css('.machines-listing-actions > button', cond=text_in, text_='Plug')
        self.assertIn('down', self.machine.execute('sudo virsh domif-getlink {} vnet0'.format(name)))
        # Plug
        self.click(self.wait_css('.machines-listing-actions > button', cond=clickable))
        self.wait_css('#vm-{}-network-1-state'.format(name), cond=text_in, text_='up')
        self.wait_css('.machines-listing-actions > button', cond=text_in, text_='Unplug')
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

        self.click(self.wait_css('#vm-{}-network-1-edit-dialog'.format(name), cond=clickable))
        self.wait_css('#vm-{}-network-1-edit-dialog-modal-window'.format(name))
        self.select(self.wait_css('#vm-{}-network-1-select-model'.format(name)), 'select_by_value', 'e1000e')
        self.wait_text('Changes will take effect after shutting down the VM', cond=invisible)
        self.click(self.wait_css('#vm-{}-network-1-edit-dialog-save'.format(name), cond=clickable))

        self.wait_dialog_disappear()
        self.wait_css('#vm-{}-network-1-edit-dialog-modal-window'.format(name), cond=invisible)

        self.wait_css('#vm-{}-network-1-model-tooltip'.format(name), cond=invisible)
        self.wait_css('#vm-{}-network-1-model'.format(name), cond=text_in, text_='e1000e')
