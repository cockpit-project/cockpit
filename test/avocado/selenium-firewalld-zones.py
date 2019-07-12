import os
import sys
from testlib_avocado.seleniumlib import SeleniumTest, clickable, visible

machine_test_dir = os.path.dirname(os.path.realpath(__file__))
if machine_test_dir not in sys.path:
    sys.path.insert(1, machine_test_dir)


class FirewalldZones(SeleniumTest):
    """
    :avocado: enable
    """

    def setUp(self):
        super().setUp()
        self.login()
        self.click(self.wait_link('Network', cond=clickable))
        self.wait_frame("network")
        self.wait_id("networking", jscheck=True)
        self.machine.execute("sudo systemctl start firewalld")
        self.machine.execute("sudo firewall-cmd --add-service=cockpit")
        self.machine.execute("sudo firewall-cmd --permanent --add-service=cockpit")
        self.click(self.wait_id("networking-firewall-link", cond=clickable))
        self.mainframe()
        self.wait_frame("network/firewall")
        self.wait_id("firewall", jscheck=True)
        self.zone_default = self.machine.execute("sudo firewall-cmd --get-default-zone").strip()
        self.zone_custom = "internal"

    def add_custom_zone(self, zone, ip_range):
        self.click(self.wait_id("add-zone-button", cond=clickable))
        self.wait_id("add-zone-dialog", jscheck=True)
        self.click(self.wait_xpath("//input[@type='radio' and @name='zone' and @value='{}']".format(zone)))
        self.click(self.wait_xpath("//input[@type='radio' and @name='add-zone-ip' and @value='ip-range']"))
        self.send_keys(self.wait_id("add-zone-ip", jscheck=True), ip_range)
        self.click(self.wait_xpath("//button[contains(text(), 'Add zone')]", cond=clickable))
        self.wait_id("firewall", jscheck=True)
        self.assertIn(zone, self.machine.execute("firewall-cmd --get-active-zones"))
        self.wait_xpath("//tr[@data-row-id='{}']".format(self.zone_custom))

    def remove_custom_zone(self, zone):
        self.click(self.wait_xpath("//tr[@data-row-id='{}']//button".format(self.zone_custom), cond=visible))
        self.wait_id("firewall", jscheck=True)
        self.assertNotIn(self.zone_custom, self.machine.execute("firewall-cmd --get-active-zones"))

    def testDefaultZoneListing(self):
        self.assertIn(self.zone_default, self.machine.execute("firewall-cmd --get-active-zones"))
        self.wait_xpath("//tr[@data-row-id='{}']".format(self.zone_default), cond=visible)

    def testAddRemoveCustomZone(self):
        self.assertNotIn(self.zone_custom, self.machine.execute("firewall-cmd --get-active-zones"))
        self.add_custom_zone(self.zone_custom, "162.168.22.22/32")
        self.remove_custom_zone(self.zone_custom)

    def testAddServiceToCustomZone(self):
        self.add_custom_zone(self.zone_custom, "162.168.22.22/32")

        service = "amqp"
        self.machine.execute("sudo firewall-cmd --remove-service={}".format(service))
        self.click(self.wait_text("Add Services"))
        self.wait_id("add-services-dialog", jscheck=True)
        self.click(self.wait_xpath("//input[@value='{}']".format(self.zone_custom)))
        self.send_keys(self.wait_id("filter-services-input"), service)
        self.click(self.wait_id("firewall-service-{}".format(service), cond=clickable))
        self.click(self.wait_xpath("//div[@id='add-services-dialog']//button[contains(text(), 'Add Services')]",
                                   cond=clickable))
        self.wait_id("firewall", jscheck=True)
        self.click(self.wait_xpath("//tr[@data-row-id='{}']".format(service)))
        self.assertIn(service, self.machine.execute("sudo firewall-cmd --zone={} --list-services".format(self.zone_custom)))
        self.machine.execute("sudo firewall-cmd --permanent --zone={} --remove-service={}".format(self.zone_custom, service))
        self.machine.execute("sudo firewall-cmd --zone={} --remove-service={}".format(self.zone_custom, service))

        self.remove_custom_zone(self.zone_custom)

    def tearDown(self):
        self.machine.execute("sudo systemctl stop firewalld")
        super().tearDown()
