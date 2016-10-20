#!/usr/bin/python

# we need to be able to find and import seleniumlib, so add this directory
import os
import sys
machine_test_dir = os.path.dirname(os.path.abspath(__file__))
if not machine_test_dir in sys.path:
    sys.path.insert(1, machine_test_dir)

from avocado import main
from avocado.utils import process
import libdisc
from seleniumlib import *

class BasicTestSuite(SeleniumTest):
    """
    :avocado: enable
    """
    def test10Base(self):
        out = process.run("hostname", shell=True)
        server_element = self.wait_id('server-name')
        self.assertTrue(str(out.stdout)[:-1] in str(server_element.text))
        self.error=False

    def test20Login(self):
        self.login()
        self.wait_id("sidebar")
        user_element = self.wait_id("content-user-name")
        self.assertEqual(user_element.text, user)
        self.logout()
        self.wait_id('server-name')
        self.login("baduser", "badpasswd")
        message_element = self.wait_id('login-error-message')
        self.assertTrue("Wrong" in message_element.text)
        self.login()
        username_element = self.wait_id("content-user-name")
        self.assertEqual(username_element.text, user)
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
        self.wait_id('containers-images')
        self.click(self.wait_link('Get new image', cond=clickable))
        self.wait_id('containers-search-image-dialog')
        self.send_keys(self.wait_id('containers-search-image-search'), "fedora")
        self.wait_id('containers-search-image-results')
        self.wait_text("Official Docker", element="td")
        self.click(self.wait_xpath(
            "//div[@id='containers-search-image-dialog']//button[contains(text(), '%s')]" % "Cancel",cond=clickable))
        self.wait_id('containers-search-image-dialog',cond=invisible)
        self.click(self.wait_link('Get new image', cond=clickable))
        self.wait_id('containers-search-image-dialog')
        self.send_keys(self.wait_id('containers-search-image-search'), "cockpit")
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
        out = process.run("systemd-cat -p notice echo '%s'" % checkt, shell=True)
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
        self.wait_text("1000 MiB", element="td")
        self.click(self.wait_link('Storage', cond=clickable))
        self.wait_xpath("//*[@data-goto-block='%s']" % other_shortname)
        self.mainframe()
        self.error=False

    def test70ChangeTabNetworking(self):
        self.login()
        self.wait_id("sidebar")
        out = process.run("ip r |grep default | head -1 | cut -d ' ' -f 5", shell=True)
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
        self.send_keys(self.wait_id('accounts-create-real-name'), 'testxx')
        self.send_keys(self.wait_id('accounts-create-pw1'), passwd)
        self.send_keys(self.wait_id('accounts-create-pw2'), passwd)
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
        terminal = self.wait_xpath("//*[@class='terminal']")
        prefix = "/tmp/cockpitrndadr/"
        self.send_keys(terminal, "mkdir {0}\n".format(prefix), clear=False)
        self.wait_text("mkdir {0}".format(prefix), user, element="div")
        self.send_keys(terminal, "touch {0}abc\n".format(prefix), clear=False)
        self.wait_text("touch {0}abc".format(prefix), user, element="div")
        self.send_keys(terminal, "touch {0}abd\n".format(prefix), clear=False)
        self.wait_text("touch {0}abd".format(prefix), user, element="div")
        self.send_keys(terminal, "ls {0}*\n".format(prefix), clear=False)
        self.wait_text("ls {0}*".format(prefix), '{0}abc'.format(prefix), element="div")
        process.run("ls {0}abc".format(prefix), shell=True)
        process.run("ls {0}abd".format(prefix), shell=True)
        self.send_keys(terminal, "rm {0}abc {0}abd\n".format(prefix), clear=False)
        self.wait_text("rm {0}abc {0}abd".format(prefix), user, element="div")
        self.send_keys(terminal, "ls {0}*\n".format(prefix), clear=False)
        self.wait_text("ls {0}*".format(prefix), 'cannot access', element="div")
        process.run("ls {0}abc |wc -l |grep 0".format(prefix), shell=True)
        process.run("ls {0}abd |wc -l |grep 0".format(prefix), shell=True)
        self.mainframe()
        self.error=False

if __name__ == '__main__':
    main()
