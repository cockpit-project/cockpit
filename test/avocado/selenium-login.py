#!/usr/bin/python
""" SETUP tasks

# workaround for RHEL7
# curl https://copr.fedoraproject.org/coprs/lmr/Autotest/repo/epel-7/lmr-Autotest-epel-7.repo > /etc/yum.repos.d/lmr-Autotest-epel-7.repo
# yum --nogpgcheck -y install python-pip
# pip install selenium
yum --nogpgcheck -y install avocado python-selenium

adduser test
echo superhardpasswordtest5554 | passwd --stdin test
usermod -a -G wheel test

# in case of you would like to use selenium server in docker:
docker run -d -p 4444:4444 --name selenium-hub selenium/hub:2.48.2
docker run -d --link selenium-hub:hub selenium/node-chrome:2.48.2
docker run -d --link selenium-hub:hub selenium/node-firefox:2.48.2

systemctl start cockpit

# RUN AS
avocado run selenium-login.py
# OR ALTERNATIVELY with docker selenium server (BROWSER=firefox or chrome)
HUB=localhost BROWSER=chrome GUEST=`hostname -i` avocado run selenium-login.py


"""

from avocado import Test
from avocado import main
from avocado.utils import process
import inspect
import selenium.webdriver
from selenium.webdriver.common.desired_capabilities import DesiredCapabilities
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
import os
import sys
import re
import time
machine_test_dir = os.path.dirname(
    os.path.abspath(inspect.getfile(inspect.currentframe())))
sys.path.append(machine_test_dir)
import libdisc

user = "test"
passwd = "superhardpasswordtest5554"

present = EC.presence_of_element_located
visible = EC.visibility_of_element_located
clickable = EC.element_to_be_clickable
invisible = EC.invisibility_of_element_located
frame = EC.frame_to_be_available_and_switch_to_it


class BasicTestSuite(Test):

    def __init__(self, *args, **kwargs):
        super(BasicTestSuite, self).__init__(*args, **kwargs)

    def setUp(self):
        if not (os.environ.has_key("HUB") or os.environ.has_key("BROWSER")):
            self.driver = selenium.webdriver.Firefox()
            guest_machine = 'localhost'
        else:
            selenium_hub = os.environ["HUB"] if os.environ.has_key(
                "HUB") else "localhost"
            browser = os.environ["BROWSER"] if os.environ.has_key(
                "BROWSER") else "firefox"
            guest_machine = os.environ["GUEST"]
            self.driver = selenium.webdriver.Remote(
                command_executor='http://%s:4444/wd/hub' % selenium_hub, desired_capabilities={'browserName': browser})

        self.driver.set_window_size(1400, 1200)
        self.driver.set_page_load_timeout(90)
        self.driver.implicitly_wait(1)
        self.default_try = 40
        self.default_sleep = 1
        self.driver.get('http://%s:9090' % guest_machine)

    def tearDown(self):
        pass
        self.driver.close()
        self.driver.quit()

    def wait(self, method, text, baseelement, overridetry, fatal, cond):
        if not baseelement:
            baseelement = self.driver
        returned = None
        excpt=""
        cond = cond if cond else visible
        # time.sleep(self.default_sleep)
        internaltry = overridetry if overridetry else self.default_try
        for foo in range(0, internaltry):
            try:
                #returned = method(text)
                returned = WebDriverWait(baseelement, self.default_sleep).until(cond((method, text)))
                if returned:
                    break
            except:
                print "REP>", foo
                #time.sleep(self.default_sleep)
                pass
        if returned is None:
            if fatal:
                screenshot_file = "snapshot-%s-%s-lines_%s.png" % (str(inspect.stack()[1][3]), str(inspect.stack(
                )[2][3]), '-'.join([str(x[2]) for x in inspect.stack() if inspect.stack()[0][1] == x[1]]))
                self.driver.get_screenshot_as_file(screenshot_file)
                print screenshot_file
                raise Exception('ERR: Unable to locate name: %s' %
                                str(text), screenshot_file)
                #returned=WebDriverWait(baseelement, self.default_sleep).until(cond((method, text)))
            else:
                return None
        return returned

    def wait_id(self, el, baseelement=None, overridetry=None, fatal=True, cond=None):
        return self.wait(By.ID, text=el, baseelement = baseelement, overridetry=overridetry, fatal=fatal, cond=cond)

    def wait_link(self, el, baseelement=None, overridetry=None, fatal=True, cond=None):
        return self.wait(By.PARTIAL_LINK_TEXT, baseelement = baseelement, text=el, overridetry=overridetry, fatal=fatal, cond=cond)

    def wait_xpath(self, el, baseelement=None, overridetry=None, fatal=True, cond=None):
        return self.wait(By.XPATH, text=el, baseelement = baseelement, overridetry=overridetry, fatal=fatal, cond=cond)

    def wait_frame(self, el, baseelement=None, overridetry=None, fatal=True, cond=None):
        text="//iframe[contains(@name,'%s')]" % el
        return self.wait(By.XPATH, text=text, baseelement = baseelement, overridetry=overridetry, fatal=fatal, cond=frame)

    def mainframe(self):
        self.driver.switch_to_default_content()

    def login(self, tmpuser=user, tmppasswd=passwd):
        elem = self.wait_id('login-user-input')
        elem.clear()
        elem.send_keys(tmpuser)
        elem = self.wait_id('login-password-input')
        elem.clear()
        elem.send_keys(tmppasswd)
        self.wait_id("login-button").click()
        return elem

    def logout(self):
        elem = self.wait_id('navbar-dropdown')
        elem.click()
        elem = self.wait_id('go-logout')
        elem.click()

    def test10Base(self):
        elem = self.wait_id('server-name')
        out = process.run("hostname", shell=True)
        self.assertTrue(str(out.stdout)[:-1] in str(elem.text))

    def test20Login(self):
        elem = self.login()
        elem = self.wait_id("content-user-name")
        self.assertEqual(elem.text, user)

        self.logout()
        elem = self.wait_id('server-name')

        elem = self.login("baduser", "badpasswd")
        elem = self.wait_xpath(
            "//*[@id='login-error-message' and @style='display: block;']")
        print elem.text
        self.assertTrue("Wrong" in elem.text)

        elem = self.login()
        elem = self.wait_id("content-user-name")
        self.assertEqual(elem.text, user)

    def test30ChangeTabServices(self):
        self.login()
        self.wait_link('Services').click()
        self.wait_frame("services")

        elem = self.wait_xpath("//*[contains(text(), '%s')]" % "Socket")
        elem.click()
        self.wait_xpath("//*[contains(text(), '%s')]" % "udev")

        elem = self.wait_xpath("//*[contains(text(), '%s')]" % "Target")
        elem.click()
        self.wait_xpath("//*[contains(text(), '%s')]" % "reboot.target")

        elem = self.wait_xpath(
            "//*[contains(text(), '%s')]" % "System Services")
        elem.click()
        self.wait_xpath("//*[contains(text(), '%s')]" % "dbus.service")

        self.mainframe()

    def test40ContainerTab(self):
        self.login()
        self.wait_link('Containers').click()
        self.wait_frame("docker")
        if self.wait_xpath("//*[@data-action='docker-start']", fatal=False, overridetry=5, cond=clickable):
            self.wait_xpath("//*[@data-action='docker-start']").click()
        elem = self.wait_id('containers')
        self.wait_id('containers-storage')
        self.wait_id('containers-images-search').click()
        elem = self.wait_id('containers-search-image-dialog')
        elem = self.wait_id('containers-search-image-search')
        elem.clear()
        elem.send_keys("fedora")
        elem = self.wait_id('containers-search-image-results')
        elem = self.wait_xpath(
            "//*[contains(text(), '%s')]" % "Official Docker")
        elem = self.wait_xpath(
            "//div[@id='containers-search-image-dialog']//button[contains(text(), '%s')]" % "Cancel",cond=clickable)
        elem.click()
        elem = self.wait_id('containers-search-image-dialog',cond=invisible)

        self.wait_id('containers-images-search',cond=clickable).click()
        elem = self.wait_id('containers-search-image-dialog')
        elem = self.wait_id('containers-search-image-search')
        elem.clear()
        elem.send_keys("cockpit")
        elem = self.wait_id('containers-search-image-results')
        elem = self.wait_xpath(
            "//*[contains(text(), '%s')]" % "Cockpit Web Ser",cond=clickable)
        elem.click()
        elem = self.wait_id('containers-search-download', cond=clickable)
        elem.click()
        elem = self.wait_id('containers-search-image-dialog', cond=invisible)
        elem = self.wait_xpath(
            "//*[@class='container-col-tags' and contains(text(), 'cockpit/ws')]")

        self.mainframe()

    def test50ChangeTabLogs(self):
        self.login()
        self.wait_link('Logs').click()
        self.wait_frame("logs")
        elem = self.wait_xpath("//button[contains(text(), 'Errors')]", cond=clickable)
        elem.click()
        elem = self.wait_xpath("//button[contains(text(), 'Warnings')]", cond=clickable)
        elem.click()
        elem = self.wait_xpath("//button[contains(text(), 'Notices')]", cond=clickable)
        elem.click()
        checkt = "ahojnotice"
        out = process.run("systemd-cat -p notice echo '%s'" %
                          checkt, shell=True)
        elem = self.wait_xpath(
            "//span[@class='cockpit-log-message' and contains(text(), '%s')]" % checkt)
        elem.click()
        elem = self.wait_id('journal-entry')
        self.mainframe()

    def test60ChangeTabStorage(self):
        reald_name = process.run(
            "storagedctl status | tail -1 |sed -r 's/.* ([a-z]+).*/\\1/'", shell=True).stdout[:-1]
        reald_serial = process.run(
            "storagedctl status | tail -1 |sed -r 's/.* ([^ ]+)\s+[a-z]+.*/\\1/'", shell=True).stdout[:-1]
        print ">>>" + reald_name + ">>>" + reald_serial + ">>>"
        other_disc = libdisc.DiscSimple()
        other_discname = other_disc.adddisc("d1")
        other_shortname = os.path.basename(other_discname)
        self.login()
        self.wait_link('Storage').click()
        self.wait_frame("storage")
        self.wait_id("drives")
        elem = self.wait_xpath("//*[@data-goto-block='%s']" % other_shortname, cond=clickable)
        elem.click()
        self.wait_id('storage-detail')
        self.wait_xpath("//td[contains(text(), '%s')]" % other_discname)
        self.wait_xpath("//td[contains(text(), '%s')]" % "Capacity")
        self.wait_xpath("//td[contains(text(), '%s')]" % "1000 MB")

        self.wait_link('Storage').click()
        elem = self.wait_xpath("//*[@data-goto-block='%s']" % other_shortname)

        self.mainframe()

    def test70ChangeTabNetworking(self):
        self.login()
        out = process.run(
            "ip r |grep default | head -1 | cut -d ' ' -f 5", shell=True)
        self.wait_link('Network').click()
        self.wait_frame("network")

        self.wait_id("networking-interfaces")
        self.wait_id("networking-tx-graph")

        elem = self.wait_xpath("//tr[@data-interface='%s']" % out.stdout[:-1],cond=clickable)
        elem.click()
        self.wait_xpath("//td[contains(text(), '%s')]" % "Carrier")
        self.mainframe()

    def test80ChangeTabTools(self):
        self.login()
        self.wait_id("tools-panel",cond=invisible)
        self.wait_link('Tools').click()
        self.wait_id("tools-panel")
        self.wait_link('Accounts').click()
        self.wait_frame("users")
        elem = self.wait_xpath(
            "//*[@class='cockpit-account-user-name' and contains(text(), '%s')]" % user, cond=clickable)
        elem.click()
        elem = self.wait_id('account')
        self.wait_xpath("//*[contains(text(), '%s')]" % "Full Name")
        self.wait_link('Accounts', elem).click()
        self.wait_xpath('//*[@id="accounts-create"]', cond=clickable).click()
        elem = self.wait_id('accounts-create-real-name')
        elem.clear()
        elem.send_keys('testxx')
        elem = self.wait_id('accounts-create-pw1')
        elem.clear()
        elem.send_keys(passwd)
        elem = self.wait_id('accounts-create-pw2')
        elem.clear()
        elem.send_keys(passwd)
        time.sleep(self.default_sleep)
        self.wait_id('accounts-create-create', cond=clickable).click()
        time.sleep(self.default_sleep)
        elem = self.wait_xpath(
            "//*[@class='cockpit-account-user-name' and contains(text(), '%s')]" % 'testxx', cond=clickable)
        elem.click()
        self.wait_id('account-delete', cond=clickable).click()
        self.wait_id('account-confirm-delete-dialog')
        self.wait_id('account-confirm-delete-apply', cond=clickable).click()
        time.sleep(self.default_sleep)
        self.mainframe()

        self.wait_link('Terminal').click()
        self.wait_frame("terminal")
        self.wait_id('terminal')
        elem = self.wait_xpath("//*[@class='terminal']")
        terminal = elem
        terminal.send_keys("touch /tmp/testabc\n")
        terminal.send_keys("touch /tmp/testabd\n")
        time.sleep(self.default_sleep)
        terminal.send_keys("ls /tmp/test*\n")
        elem = self.wait_xpath(
            "//div[contains(text(), '%s') and contains(text(), '%s')]" % ('/tmp/testabc', '/tmp/testabd'))
        self.assertTrue("/tmp/testabc" in elem.text)
        process.run("ls /tmp/testabc", shell=True)
        time.sleep(self.default_sleep)
        terminal.send_keys("rm /tmp/testabc /tmp/testabd\n")
        time.sleep(self.default_sleep)
        terminal.send_keys("ls /tmp/test*\n")
        elem = self.wait_xpath(
            "//div[contains(text(), '%s') and contains(text(), '%s')]" % ('cannot', 'access'))
        self.assertTrue("No such file" in elem.text)
        process.run("ls /tmp/testabc |wc -l |grep 0", shell=True)
        process.run("ls /tmp/testabd |wc -l |grep 0", shell=True)
        self.mainframe()

if __name__ == '__main__':
    main()
