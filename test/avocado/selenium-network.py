from testlib_avocado.seleniumlib import SeleniumTest, clickable, visible
import os
import sys

machine_test_dir = os.path.dirname(os.path.realpath(__file__))
if machine_test_dir not in sys.path:
    sys.path.insert(1, machine_test_dir)


class NeworkTestSuite(SeleniumTest):
    """
    :avocado: enable
    """

    def setUp(self):
        super(NeworkTestSuite, self).setUp()
        self.login()
        self.click(self.wait_link('Network', cond=clickable))
        self.wait_frame("network")
        self.wait_id("networking", jscheck=True)

    def testBasePage(self):
        main_interface = self.machine.execute("/usr/sbin/ip r | grep default | head -1 | cut -d ' ' -f 5").strip()
        self.wait_id("networking-interfaces")
        self.assertNotEqual(main_interface, '')
        self.wait_xpath("//tr[@data-interface='{}']".format(main_interface))

    def testGraphs(self):
        self.wait_id("networking-interfaces", cond=visible)
        self.wait_id("networking-tx-graph", cond=visible)

    def testSanityVlans(self):
        self.click(self.wait_id("networking-add-vlan", cond=clickable))
        self.click(self.wait_id("network-vlan-settings-cancel", cond=clickable))
        self.wait_id("networking-interfaces", cond=visible)

    def testSanityBridge(self):
        self.click(self.wait_id("networking-add-bridge", cond=clickable))
        self.wait_text("Bridge Settings")
        self.click(self.wait_id(
            "network-bridge-settings-cancel", cond=clickable))
        self.wait_id("networking-interfaces", cond=visible)

    def testSanityBond(self):
        self.click(self.wait_id("networking-add-bond", cond=clickable))
        self.wait_text("Bond Settings")
        self.click(self.wait_id("network-bond-settings-cancel", cond=clickable))
        self.wait_id("networking-interfaces", cond=visible)
