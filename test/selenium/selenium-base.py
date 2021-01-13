#!/usr/bin/python3

# we need to be able to find and import seleniumlib, so add this directory
from testlib_avocado.seleniumlib import SeleniumTest, clickable
import os
import sys
machine_test_dir = os.path.dirname(os.path.abspath(__file__))
if machine_test_dir not in sys.path:
    sys.path.insert(1, machine_test_dir)


class BasicTestSuite(SeleniumTest):
    """
    :avocado: enable
    """

    def test10Base(self):
        # this is minimal cockpit test what checks login page
        self.wait_id('server-name')

    def test15BaseSSHKeyAdded(self):
        # calling self.login() ensures there is added public ssh key to user to be able to call
        # machine.execute(...)
        self.login()
        self.logout()
        out = self.machine.execute("hostname")
        server_element = self.wait_id('server-name')
        self.assertIn(out.strip(), str(server_element.text))

    def test30ChangeTabServices(self):
        self.login()
        self.click(self.wait_link('Services', cond=clickable))
        self.wait_frame("services")
        self.wait_id("services-list")
        self.click(self.wait_text("Socket", cond=clickable))
        self.wait_text("udev")
        self.wait_id("services-list")
        self.click(self.wait_text("Target", cond=clickable))
        self.wait_id("services-list")
        self.wait_text("reboot.target")
        self.click(self.wait_text("System services", cond=clickable))
        self.wait_id("services-list")
        self.wait_text("sshd")
        self.mainframe()

    def test70ChangeTabNetworking(self):
        self.login()
        out = self.machine.execute("/usr/sbin/ip r |grep default | head -1 | cut -d ' ' -f 5").strip()
        self.click(self.wait_link('Network', cond=clickable))
        self.wait_frame("network")
        self.wait_id("networking-interfaces")

        self.click(self.wait_xpath("//tr[@data-interface='%s']" % out, cond=clickable))
        self.wait_text("Carrier", element="td")
        self.mainframe()
