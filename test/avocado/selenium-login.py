#!/usr/bin/python

from avocado import main
from avocado.utils import process
import os
import sys
machine_test_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(machine_test_dir)
from seleniumlib import *
import libdisc

class BasicTestSuite(SeleniumTest):
    """
    :avocado: enable
    """
    def test10Base(self):
        out = process.run("hostname", shell=True)
        elem = self.wait_id('server-name')
        self.assertTrue(str(out.stdout)[:-1] in str(elem.text))
        self.error=False

    def test20Login(self):
        self.login()
        self.wait_id("sidebar")
        elem = self.wait_id("content-user-name")
        self.assertEqual(elem.text, user)
        self.logout()
        self.wait_id('server-name')
        self.login("baduser", "badpasswd")
        elem = self.wait_id('login-error-message')
        self.assertTrue("Wrong" in elem.text)
        self.login()
        elem = self.wait_id("content-user-name")
        self.assertEqual(elem.text, user)
        self.error=False

    def test30ChangeTabServices(self):
        self.login()
        self.wait_id("sidebar")
        self.click(self.wait_link('Services', cond=clickable))
        self.wait_frame("services")
        self.wait_id("services-list-enabled")
        self.click(self.wait_text("Socket", cond=clickable))
        self.wait_text("udev")
        self.wait_id("services-list-enabled")
        self.click(self.wait_text("Target", cond=clickable))
        self.wait_id("services-list-enabled")
        self.wait_text("reboot.target")
        self.click(self.wait_text("System Services", cond=clickable))
        self.wait_id("services-list-enabled")
        self.wait_text("dbus.service")
        self.mainframe()
        self.error=False

    def test40ContainerTab(self):
        self.login()
        self.wait_id("sidebar")
        self.click(self.wait_link('Containers', cond=clickable))
        self.wait_frame("docker")
        if self.wait_xpath("//*[@data-action='docker-start']", fatal=False, overridetry=5, cond=clickable):
            self.click(self.wait_xpath("//*[@data-action='docker-start']",cond=clickable))
        self.wait_id('containers')
        self.wait_id('containers-storage')
        self.click(self.wait_id('containers-images-search', cond=clickable))
        self.wait_id('containers-search-image-dialog')
        elem = self.wait_id('containers-search-image-search')
        elem.clear()
        elem.send_keys("fedora")
        self.wait_id('containers-search-image-results')
        self.wait_text("Official Docker", element="td")
        self.click(self.wait_xpath(
            "//div[@id='containers-search-image-dialog']//button[contains(text(), '%s')]" % "Cancel",cond=clickable))
        self.wait_id('containers-search-image-dialog',cond=invisible)
        self.click(self.wait_id('containers-images-search',cond=clickable))
        self.wait_id('containers-search-image-dialog')
        elem = self.wait_id('containers-search-image-search')
        elem.clear()
        elem.send_keys("cockpit")
        self.wait_id('containers-search-image-results')
        self.click(self.wait_text("Cockpit Web Ser", element="td", cond=clickable))
        self.click(self.wait_id('containers-search-download', cond=clickable))
        self.wait_id('containers-search-image-dialog', cond=invisible)
        self.wait_text('cockpit/ws')
        self.mainframe()
        self.error=False

    def test50ChangeTabLogs(self):
        self.login()
        self.wait_id("sidebar")
        self.click(self.wait_link('Logs', cond=clickable))
        self.wait_frame("logs")
        self.wait_id("journal")
        self.wait_id("journal-current-day")
        self.wait_id("journal-prio")
        self.click(self.wait_text('Errors', cond=clickable, element="button"))
        self.wait_id("journal")
        self.wait_id("journal-current-day")
        self.click(self.wait_text('Warnings', cond=clickable, element="button"))
        self.wait_id("journal")
        self.wait_id("journal-current-day")
        self.click(self.wait_text('Notices', cond=clickable, element="button"))
        self.wait_id("journal")
        self.wait_id("journal-current-day")
        checkt = "ahojnotice"
        out = process.run("systemd-cat -p notice echo '%s'" %
                          checkt, shell=True)
        self.click(self.wait_text(checkt, cond=clickable))
        self.wait_id('journal-entry')
        self.mainframe()
        self.error=False

    def test60ChangeTabStorage(self):
        other_disc = libdisc.DiscSimple()
        other_discname = other_disc.adddisc("d1")
        other_shortname = os.path.basename(other_discname)
        self.login()
        self.wait_id("sidebar")
        self.click(self.wait_link('Storage', cond=clickable))
        self.wait_frame("storage")
        self.wait_id("drives")
        self.click(self.wait_xpath("//*[@data-goto-block='%s']" % other_shortname, cond=clickable))
        self.wait_id('storage-detail')
        self.wait_text(other_discname, element="td")
        self.wait_text("Capacity", element="td")
        self.wait_text("1000 MB", element="td")
        self.click(self.wait_link('Storage', cond=clickable))
        self.wait_xpath("//*[@data-goto-block='%s']" % other_shortname)
        self.mainframe()
        self.error=False

    def test70ChangeTabNetworking(self):
        self.login()
        self.wait_id("sidebar")
        out = process.run(
            "ip r |grep default | head -1 | cut -d ' ' -f 5", shell=True)
        self.click(self.wait_link('Network', cond=clickable))
        self.wait_frame("network")
        self.wait_id("networking-interfaces")
        self.wait_id("networking-tx-graph")

        self.click(self.wait_xpath("//tr[@data-interface='%s']" % out.stdout[:-1],cond=clickable))
        self.wait_text("Carrier", element="td")
        self.mainframe()
        self.error=False

    def test80ChangeTabTools(self):
        self.login()
        self.wait_id("sidebar")
        self.wait_id("tools-panel",cond=invisible)
        self.click(self.wait_link('Tools', cond=clickable))
        self.wait_id("tools-panel")
        self.click(self.wait_link('Accounts', cond=clickable))
        self.wait_frame("users")
        self.click(self.wait_xpath(
            "//*[@class='cockpit-account-user-name' and contains(text(), '%s')]" % user, cond=clickable))
        self.wait_id('account')
        self.wait_text("Full Name")
        self.click(self.wait_link('Accounts', cond=clickable))
        self.click(self.wait_id("accounts-create", cond=clickable))
        self.wait_id("accounts-create-dialog")
        self.wait_id('accounts-create-create', cond=clickable)
        elem = self.wait_id('accounts-create-real-name')
        elem.clear()
        elem.send_keys('testxx')
        elem = self.wait_id('accounts-create-pw1')
        elem.clear()
        elem.send_keys(passwd)
        elem = self.wait_id('accounts-create-pw2')
        elem.clear()
        elem.send_keys(passwd)
        self.wait_xpath("//span[@id='accounts-create-password-meter-message' and contains(text(), '%s')]" % "Excellent")
        self.click(self.wait_id('accounts-create-create', cond=clickable))
        self.click(self.wait_xpath(
            "//*[@class='cockpit-account-user-name' and contains(text(), '%s')]" % 'testxx', cond=clickable))
        self.click(self.wait_id('account-delete', cond=clickable))
        self.wait_id('account-confirm-delete-dialog')
        self.click(self.wait_id('account-confirm-delete-apply', cond=clickable))
        self.wait_xpath(
            "//*[@class='cockpit-account-user-name' and contains(text(), '%s')]" % user, cond=clickable)
        self.mainframe()

        self.click(self.wait_link('Terminal', cond=clickable))
        self.wait_frame("terminal")
        self.wait_id('terminal')
        terminal = self.wait_xpath("//*[@class='terminal']")
        terminal.send_keys("touch /tmp/testabc\n")
        self.wait_text("touch /tmp/testabc", user, element="div")
        terminal.send_keys("touch /tmp/testabd\n")
        self.wait_text("touch /tmp/testabd",user, element="div")
        terminal.send_keys("ls /tmp/test*\n")
        self.wait_text("ls /tmp/test*",'/tmp/testabc /tmp/testabd', element="div")
        process.run("ls /tmp/testabc", shell=True)
        process.run("ls /tmp/testabd", shell=True)
        terminal.send_keys("rm /tmp/testabc /tmp/testabd\n")
        self.wait_text("rm /tmp/testabc /tmp/testabd",user, element="div")
        terminal.send_keys("ls /tmp/test*\n")
        self.wait_text("ls /tmp/test*",'cannot access', element="div")
        process.run("ls /tmp/testabc |wc -l |grep 0", shell=True)
        process.run("ls /tmp/testabd |wc -l |grep 0", shell=True)
        self.mainframe()
        self.error=False

if __name__ == '__main__':
    main()
