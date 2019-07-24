from testlib_avocado.seleniumlib import SeleniumTest, clickable
import os
import sys

machine_test_dir = os.path.dirname(os.path.realpath(__file__))
if machine_test_dir not in sys.path:
    sys.path.insert(1, machine_test_dir)


class TestDashboard(SeleniumTest):
    """
    :avocado: enable
    """

    def testDashboard(self):
        # FIXME edge contains bug https://github.com/cockpit-project/cockpit/issues/10767
        if self.driver.capabilities['browserName'] == 'MicrosoftEdge':
            return

        self.login()
        self.click(self.wait_xpath("//a[@href='/dashboard']", cond=clickable))
        self.wait_frame("cockpit1:localhost/dashboard")
        self.wait_id("dashboard", jscheck=True)
        ip_addr = "127.0.0.3"
        self.click(self.wait_id("dashboard-add", cond=clickable, jscheck=True))

        self.wait_id("dashboard_setup_server_dialog", jscheck=True)
        add_machine_element = self.wait_id("add-machine-address")
        self.send_keys(add_machine_element, ip_addr, clear=True)

        self.click(self.wait_id("dashboard_setup_server_dialog", jscheck=True))

        self.click(self.wait_text("Add", cond=clickable, element="button"))
        connect_element = self.wait_text("Connect", cond=clickable, element="button", fatal=False, overridetry=5)
        if connect_element:
            self.click(connect_element)
        self.click(self.wait_id("dashboard-enable-edit", cond=clickable))
        self.click(self.wait_xpath("//button[contains(@class,'delete-%s')]" % ip_addr, cond=clickable))
