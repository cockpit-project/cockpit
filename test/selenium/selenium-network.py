from testlib_avocado.seleniumlib import SeleniumTest, clickable, visible
from testlib_avocado.libnetwork import Veth, Bond
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
        super().setUp()
        self.login()
        self.reload_frame()

    def reload_frame(self):
        self.mainframe()
        self.refresh("network", self.wait_link('Network', cond=clickable))
        self.wait_id("networking")

    def testBasePage(self):
        self.wait_id("networking-interfaces")
        with Veth(self.machine, "ttiface") as veth:
            veth.left.set_ipv4("192.168.226.22/24", "192.168.226.1")
            veth.left.con_up()
            self.wait_xpath("//tr[@data-interface='{}']".format(veth.left.name))

    def testSanityVlans(self):
        self.click(self.wait_id("networking-add-vlan", cond=clickable))
        self.click(self.wait_id("network-vlan-settings-cancel", cond=clickable))
        self.wait_id("networking-interfaces", cond=visible)

    def testSanityBridge(self):
        self.click(self.wait_id("networking-add-bridge", cond=clickable))
        self.wait_text("Bridge settings")
        self.click(self.wait_id(
            "network-bridge-settings-cancel", cond=clickable))
        self.wait_id("networking-interfaces", cond=visible)

    def testSanityBond(self):
        self.click(self.wait_id("networking-add-bond", cond=clickable))
        self.wait_text("Bond settings")
        self.click(self.wait_id("network-bond-settings-cancel", cond=clickable))
        self.wait_id("networking-interfaces", cond=visible)


class Bonding(NeworkTestSuite):
    """
    :avocado: enable
    """
    if_prefix = "tt"

    def setUp(self):
        super().setUp()
        self.veth1 = Veth(self.machine, self.if_prefix + "sla1")
        self.bond = Bond(self.machine, self.if_prefix + "bnd")
        self.bond.attach_member(self.veth1.left)
        self.bond.set_ipv4("192.168.223.150/24", "192.168.1.1")
        self.reload_frame()

    def tearDown(self):
        super().tearDown()
        self.bond.cleanup()
        self.veth1.cleanup()
        self.bond.remove_connections("^" + self.if_prefix)

    def testMemberRemove(self):
        self.wait_css("#networking-interfaces tr[data-interface='%s'] button" % self.bond.name, cond=clickable)
        self.click(self.wait_css("#networking-interfaces tr[data-interface='%s'] button" % self.bond.name, cond=clickable))
        self.click(self.wait_css("tr[data-interface='%s'] button" % self.veth1.left.name, cond=clickable))
        self.click(self.wait_link("Networking", cond=clickable))
