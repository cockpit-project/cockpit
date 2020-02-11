#!/usr/bin/python3

# we need to be able to find and import seleniumlib, so add this directory
from testlib_avocado.seleniumlib import SeleniumTest, user, clickable, passwd, visible
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

    def test20Login(self):
        self.login()
        user_element = self.wait_id("content-user-name")
        self.assertEqual(user_element.text, user)
        self.logout()
        self.wait_id('server-name')
        self.login("baduser", "badpasswd", wait_hostapp=False, add_ssh_key=False)
        message_element = self.wait_id('login-error-message')
        self.assertIn("Wrong", message_element.text)
        self.login()
        username_element = self.wait_id("content-user-name")
        self.assertEqual(username_element.text, user)

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
        self.click(self.wait_text("System Services", cond=clickable))
        self.wait_id("services-list")
        self.wait_text("sshd")
        self.mainframe()

    def test50ChangeTabLogs(self):
        self.login()
        self.click(self.wait_link('Logs', cond=clickable))
        self.wait_frame("logs")
        self.wait_id("journal")
        self.wait_id("journal-current-day-menu")
        self.wait_id("journal-prio")
        self.click(self.wait_xpath(
            "//span[@id='journal-prio' and contains(text(), '%s')]" % "Error and above"))
        self.wait_id("prio-lists")
        self.click(self.wait_xpath(
            "//a[@data-prio='*' and contains(text(), '%s')]" % "Everything"))
        self.wait_id("journal")
        self.wait_id("journal-current-day-menu")
        self.click(self.wait_xpath(
            "//span[@id='journal-prio' and contains(text(), '%s')]" % "Everything"))
        self.wait_id("prio-lists")
        self.click(self.wait_xpath(
            "//a[@data-prio='0' and contains(text(), '%s')]" % "Only Emergency"))
        self.wait_id("journal")
        self.wait_id("journal-current-day-menu")
        self.click(self.wait_xpath(
            "//span[@id='journal-prio' and contains(text(), '%s')]" % "Only Emergency"))
        self.wait_id("prio-lists")
        self.click(self.wait_xpath(
            "//a[@data-prio='1' and contains(text(), '%s')]" % "Alert and above"))
        self.wait_id("journal")
        self.wait_id("journal-current-day-menu")
        self.click(self.wait_xpath(
            "//span[@id='journal-prio' and contains(text(), '%s')]" % "Alert and above"))
        self.wait_id("prio-lists")
        self.click(self.wait_xpath(
            "//a[@data-prio='2' and contains(text(), '%s')]" % "Critical and above"))
        self.wait_id("journal")
        self.wait_id("journal-current-day-menu")
        self.click(self.wait_xpath(
            "//span[@id='journal-prio' and contains(text(), '%s')]" % "Critical and above"))
        self.wait_id("prio-lists")
        self.click(self.wait_xpath(
            "//a[@data-prio='3' and contains(text(), '%s')]" % "Error and above"))
        self.wait_id("journal")
        self.wait_id("journal-current-day-menu")
        self.click(self.wait_xpath(
            "//span[@id='journal-prio' and contains(text(), '%s')]" % "Error and above"))
        self.wait_id("prio-lists")
        self.click(self.wait_xpath(
            "//a[@data-prio='4' and contains(text(), '%s')]" % "Warning and above"))
        self.wait_id("journal")
        self.wait_id("journal-current-day-menu")
        self.click(self.wait_xpath(
            "//span[@id='journal-prio' and contains(text(), '%s')]" % "Warning and above"))
        self.wait_id("prio-lists")
        self.click(self.wait_xpath(
            "//a[@data-prio='5' and contains(text(), '%s')]" % "Notice and above"))
        self.wait_id("journal")
        self.wait_id("journal-current-day-menu")
        self.click(self.wait_xpath(
            "//span[@id='journal-prio' and contains(text(), '%s')]" % "Notice and above"))
        self.wait_id("prio-lists")
        self.click(self.wait_xpath(
            "//a[@data-prio='6' and contains(text(), '%s')]" % "Info and above"))
        self.wait_id("journal")
        self.wait_id("journal-current-day-menu")
        self.click(self.wait_xpath(
            "//span[@id='journal-prio' and contains(text(), '%s')]" % "Info and above"))
        self.wait_id("prio-lists")
        self.click(self.wait_xpath(
            "//a[@data-prio='7' and contains(text(), '%s')]" % "Debug and above"))
        self.wait_id("journal")
        self.wait_id("journal-current-day-menu")
        self.click(self.wait_xpath(
            "//span[@id='journal-prio' and contains(text(), '%s')]" % "Debug and above"))
        self.wait_id("prio-lists")
        checkt = "ahojnotice"
        self.machine.execute("systemd-cat -p debug echo '%s'" % checkt)
        self.click(self.wait_text(checkt, cond=clickable))
        self.wait_id('journal-entry')
        self.mainframe()

    def test70ChangeTabNetworking(self):
        self.login()
        out = self.machine.execute("/usr/sbin/ip r |grep default | head -1 | cut -d ' ' -f 5").strip()
        self.click(self.wait_link('Network', cond=clickable))
        self.wait_frame("network")
        self.wait_id("networking-interfaces")
        self.wait_id("networking-tx-graph")

        self.click(self.wait_xpath("//tr[@data-interface='%s']" % out, cond=clickable))
        self.wait_text("Carrier", element="td")
        self.mainframe()

    def test80Accounts(self):
        self.login()
        username = "selfcheckuser"
        self.click(self.wait_link('Accounts', cond=clickable))
        self.wait_frame("users")
        self.click(self.wait_xpath(
            "//*[@class='cockpit-account-user-name' and contains(text(), '%s')]" % user, cond=clickable))
        self.wait_id('account')
        self.wait_text("Full Name")
        self.mainframe()
        self.click(self.wait_link('Accounts', cond=clickable))
        self.wait_frame('users')
        self.wait_id("accounts", cond=visible)
        self.click(self.wait_id("accounts-create", cond=clickable))
        self.wait_id("accounts-create-dialog")
        self.wait_id('accounts-create-create', cond=clickable)
        self.send_keys(self.wait_id('accounts-create-real-name'), username)
        self.send_keys(self.wait_id('accounts-create-pw1'), passwd)
        self.send_keys(self.wait_id('accounts-create-pw2'), passwd)
        self.wait_xpath("//span[@id='accounts-create-password-meter-message' and contains(text(), '%s')]" % "Excellent")
        self.click(self.wait_id('accounts-create-create', cond=clickable))
        self.wait_id("accounts", cond=visible)
        self.click(self.wait_xpath(
            "//*[@class='cockpit-account-user-name' and contains(text(), '%s')]" % username, cond=clickable))

        self.click(self.wait_id('account-delete', cond=clickable))
        self.wait_id('account-confirm-delete-dialog')
        self.click(self.wait_id('account-confirm-delete-apply', cond=clickable))
        self.wait_id("accounts", cond=visible)
        self.wait_id("accounts-list", cond=visible)
        self.mainframe()
