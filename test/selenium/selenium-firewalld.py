from testlib_avocado.seleniumlib import SeleniumTest, clickable, visible
import os
import sys
import time

machine_test_dir = os.path.dirname(os.path.realpath(__file__))
if machine_test_dir not in sys.path:
    sys.path.insert(1, machine_test_dir)


class FirewalldBasePage(SeleniumTest):
    """
    :avocado: enable
    """

    def setUp(self):
        super().setUp()
        self.login()
        self.click(self.wait_link('Network', cond=clickable))
        self.wait_frame("network")
        self.wait_id("networking")
        self.machine.execute("sudo systemctl stop firewalld")

    def testEnabling(self):
        self.wait_id("networking-firewall-link", cond=clickable)
        self.wait_id("networking-firewall-switch", cond=clickable).click()
        self.wait_id("networking-firewall")
        self.machine.execute("sudo firewall-cmd --add-service=cockpit")

    def wait_firewall_enabled(self):
        # TODO: find better way how to wait for enabled firewalld inside cockpit
        # unable to see input (checkbox) element via selenium
        # wait to cockpit async settle system command result
        time.sleep(5)

    def testServiceList(self):
        self.testEnabling()
        self.wait_firewall_enabled()
        self.wait_id("networking-firewall-summary", cond=clickable)
        element = self.wait_id("networking-firewall-summary", cond=clickable)
        self.assertIn("Active Zone", element.text)
        self.assertGreater(int(element.text.split(" ")[0].strip()), 0)

    def testServiceEnabledByCommand(self):
        self.machine.execute("sudo systemctl start firewalld")
        self.machine.execute("sudo firewall-cmd --add-service=cockpit")
        self.wait_firewall_enabled()
        element = self.wait_id("networking-firewall-summary", cond=clickable)
        self.assertIn("Active Zone", element.text)
        self.assertGreater(int(element.text.split(" ")[0].strip()), 0)

    def tearDown(self):
        self.machine.execute("sudo systemctl stop firewalld")
        super().tearDown()


class FirewalldPage(FirewalldBasePage):
    """
    :avocado: enable
    """
    def setUp(self):
        super().setUp()
        self.testEnabling()
        self.click(self.wait_id("networking-firewall-link", cond=clickable))
        self.mainframe()
        self.wait_frame("network/firewall")
        self.wait_id("firewall")
        self.zone_default = self.machine.execute("sudo firewall-cmd --get-default-zone").strip()

    def testCockpitService(self):
        self.click(self.wait_xpath("//div[contains(@class,'zone-section')]//tr[@data-row-id='cockpit']"))
        self.wait_text("Cockpit lets you access and configure your server remotely.", cond=visible)

    def testAddService(self):
        service = "amqp"
        self.machine.execute("sudo firewall-cmd --remove-service={}".format(service))
        self.click(self.wait_xpath("//div[@data-id='{}']//button[@id='add-services-button']".format(self.zone_default)))
        self.wait_id("add-services-dialog")
        self.send_keys(self.wait_id("filter-services-input"), service)
        self.click(self.wait_id("firewall-service-{}".format(service), cond=clickable))
        self.click(self.wait_xpath("//div[@id='add-services-dialog']//button[contains(text(), 'Add Services')]", cond=clickable))
        self.wait_id("firewall")
        self.click(self.wait_xpath("//div[@data-id='{}']//tr[@data-row-id='{}']".format(self.zone_default, service)))
        self.assertIn(service, self.machine.execute("sudo firewall-cmd --list-services"))
        self.machine.execute("sudo firewall-cmd --remove-service={}".format(service))

    def testRemoveService(self):
        service = "amqp"
        self.machine.execute("sudo firewall-cmd --add-service={}".format(service))
        self.assertIn(service, self.machine.execute("sudo firewall-cmd --list-services"))
        self.click(self.wait_xpath("//div[@data-id='{}']//tr[@data-row-id='{}']".format(self.zone_default, service)))
        self.click(self.wait_xpath("//div[@data-id='{}']//tr[@data-row-id='{}']/following-sibling::tr[1]//button[contains(@class, 'btn-danger')]".format(self.zone_default, service)))
        self.assertFalse(self.wait_id("firewall-service-{}".format(service), cond=clickable, overridetry=3, fatal=False))
