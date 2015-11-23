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


import selenium.webdriver
from selenium.webdriver.common.desired_capabilities import DesiredCapabilities
from avocado import Test
from avocado import main
from avocado.utils import process
import time
import os
import re
import inspect

user = "test"
passwd = "superhardpasswordtest5554"


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
        #

        self.driver.set_window_size(1024, 768)
        self.driver.set_page_load_timeout(30)
        self.driver.implicitly_wait(10)
        self.default_try = 10
        self.default_sleep = 1
        self.driver.get('https://%s:9090' % guest_machine)

    def tearDown(self):
        pass
        self.driver.close()
        self.driver.quit()

    def wait(self, method, text):
        returned = None
        for foo in (0, self.default_try):
            try:
                returned = method(text)
                break
            except:
                print "."
                time.sleep(self.default_sleep)
                pass
        if returned is None:
            self.driver.get_screenshot_as_file(
                "snapshot-%s-%s.png" % (str(inspect.stack()[1][3]), str(inspect.stack()[2][3])))
            print "snapshot-%s-%s.png" % (str(inspect.stack()[1][3]), str(inspect.stack()[2][3]))
            method(text)
        return method(text)

    def wait_id(self, el, baseelement=None):
        if not baseelement:
            baseelement = self.driver
        return self.wait(baseelement.find_element_by_id, el)

    def wait_link(self, el, baseelement=None):
        if not baseelement:
            baseelement = self.driver
        return self.wait(baseelement.find_element_by_partial_link_text, el)

    def wait_xpath(self, el, baseelement=None):
        if not baseelement:
            baseelement = self.driver
        return self.wait(baseelement.find_element_by_xpath, el)

    def wait_iframe(self, el, baseelement=None):
        if not baseelement:
            baseelement = self.driver
        out = None
        iframes = self.wait(baseelement.find_elements_by_xpath, "//iframe")
        if len(iframes) == 0:
            raise Exception('There is no iframe, but SHOULD be')
        elif len(iframes) == 1:
            out = [x for x in iframes][0]
        else:
            for frame in iframes:
                if el in str(frame.get_attribute("name")):
                    out = frame
            for frame in iframes:
                if "shell" in str(frame.get_attribute("name")):
                    out = frame
        print out
        return out

    def mainframe(self):
        self.driver.switch_to_default_content()

    def selectframe(self, framename, baseelement=None):
        if not baseelement:
            baseelement = self.driver
        baseelement.switch_to_frame(self.wait_iframe(framename))

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
        self.wait_iframe("system")
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
        self.wait_iframe("system")
        elem = self.wait_id("content-user-name")
        self.assertEqual(elem.text, user)

    def test30ChangeTabServices(self):
        self.login()
        self.wait_iframe("system")
        self.wait_link('Services').click()
        self.selectframe("services")

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
        self.wait_iframe("system")
        self.wait_link('Containers').click()
        self.selectframe("docker")

        elem = self.wait_id('containers')
        if "display: none;" in str(elem.get_attribute("style")):
            elem = self.wait_xpath("//*[@data-action='docker-start']")
            elem.click()
        elem = self.wait_xpath(
            "//*[@id='containers' and @style='display: block;']")
        self.wait_id('containers-storage')
        self.wait_id('containers-images-search').click()
        elem = self.wait_xpath(
            "//*[@id='containers-search-image-dialog' and @style='display: block;']")
        baseelem = elem
        elem = self.wait_id('containers-search-image-search', baseelem)
        elem.clear()
        elem.send_keys("fedora")
        elem = self.wait_xpath(
            "//*[@id='containers-search-image-results' and @style='display: block;']", baseelem)
        elem = self.wait_xpath(
            "//*[contains(text(), '%s')]" % "Official Fedora", baseelem)
        elem = self.wait_xpath(
            "//div[@id='containers-search-image-dialog']//button[contains(text(), '%s')]" % "Cancel")
        elem.click()
        elem = self.wait_xpath(
            "//*[@id='containers-search-image-dialog' and @style='display: none;']")

        self.wait_id('containers-images-search').click()
        elem = self.wait_xpath(
            "//*[@id='containers-search-image-dialog' and @style='display: block;']")
        baseelem = elem
        elem = self.wait_id('containers-search-image-search')
        elem.clear()
        elem.send_keys("cockpit")
        elem = self.wait_xpath(
            "//*[@id='containers-search-image-results' and @style='display: block;']")
        elem = self.wait_xpath(
            "//*[contains(text(), '%s')]" % "Cockpit Web Ser")
        elem.click()
        elem = self.wait_id('containers-search-download', baseelem)
        elem.click()
        elem = self.wait_xpath(
            "//*[@id='containers-search-image-dialog' and @style='display: none;']")
        elem = self.wait_xpath(
            "//*[@class='container-col-tags' and contains(text(), 'cockpit/ws')]")

        self.mainframe()

    def test50ChangeTabLogs(self):
        self.login()
        self.wait_iframe("system")
        self.wait_link('Logs').click()
        self.selectframe("logs")
        elem = self.wait_xpath("//button[contains(text(), 'Errors')]")
        elem.click()
        elem = self.wait_xpath("//button[contains(text(), 'Warnings')]")
        elem.click()
        elem = self.wait_xpath("//button[contains(text(), 'Notices')]")
        elem.click()
        elem = self.wait_xpath("//button[contains(text(), 'All')]")
        elem.click()
        elem = self.wait_xpath(
            "//*[@class='cockpit-log-service' and contains(text(), 'Docker')]")
        elem.click()
        elem = self.wait_xpath(
            "//*[@id='journal-entry' and @style='display: block;']")
        self.mainframe()

    def test60ChangeTabStorage(self):
        name = process.run(
            "storagedctl status | tail -1 |sed -r 's/.* ([a-z]+).*/\\1/'", shell=True).stdout[:-1]
        serial = process.run(
            "storagedctl status | tail -1 |sed -r 's/.* ([^ ]+)\s+[a-z]+.*/\\1/'", shell=True).stdout[:-1]
        print ">>>" + name + ">>>" + serial + ">>>"

        self.login()
        self.wait_iframe("system")
        self.wait_link('Storage').click()
        self.selectframe("storage")
        elem = self.wait_id("drives")
        elem = self.wait_xpath("//*[@data-goto-block='%s']" % name)
        elem.click()
        elem = self.wait_xpath(
            "//*[@id='storage-detail' and @style='display: block;']")
        basel = elem
        self.wait_xpath("//*[contains(text(), '%s')]" % "Firmware Version")
        self.wait_xpath("//*[contains(text(), '%s')]" % serial)

        self.wait_link('Storage', basel).click()
        elem = self.wait_xpath("//*[@data-goto-block='%s']" % name)

        self.mainframe()

    def test70ChangeTabNetworking(self):
        self.login()
        self.wait_iframe("system")
        out = process.run(
            "ip r |grep default | head -1 | cut -d ' ' -f 5", shell=True)
        self.wait_link('Network').click()
        self.selectframe("network")

        self.wait_id("networking-interfaces")
        self.wait_id("networking-tx-graph")

        elem = self.wait_xpath("//*[contains(text(), '%s')]" % out.stdout[:-1])
        self.mainframe()

    def test80ChangeTabTools(self):
        self.login()
        self.wait_iframe("system")
        elem = self.wait_link('Tools')
        self.assertEqual(elem.get_attribute('class'), "collapsed")
        elem.click()
        elem = self.wait_link('Tools')
        self.assertEqual(elem.get_attribute('class'), "")
        elem.click()
        elem = self.wait_link('Tools')
        self.assertEqual(elem.get_attribute('class'), "collapsed")
        elem.click()

        self.wait_link('Accounts').click()
        self.selectframe("users")
        elem = self.wait_xpath(
            "//*[@class='cockpit-account-user-name' and contains(text(), '%s')]" % user)
        elem.click()
        elem = self.wait_xpath(
            "//*[@id='account' and @style='display: block;']")
        self.wait_xpath("//*[contains(text(), '%s')]" % "Full Name")
        self.wait_link('Accounts', elem).click()
        self.wait_id('accounts-create').click()
        elem = self.wait_id('accounts-create-real-name')
        elem.clear()
        elem.send_keys('testxx')
        elem = self.wait_id('accounts-create-pw1')
        elem.clear()
        elem.send_keys(passwd)
        elem = self.wait_id('accounts-create-pw2')
        elem.clear()
        elem.send_keys(passwd)
        self.wait_id('accounts-create-create').click()
        elem = self.wait_xpath(
            "//*[@class='cockpit-account-user-name' and contains(text(), '%s')]" % 'testxx')
        elem.click()
        self.wait_id('account-delete').click()
        elem = self.wait_xpath(
            "//*[@id='account-confirm-delete-dialog' and @style='display: block;']")
        self.wait_id('account-confirm-delete-apply').click()

        self.mainframe()

        self.wait_link('Terminal').click()
        self.selectframe("terminal")
        elem = self.wait_xpath("//*[@class='terminal']")
        terminal = elem
        terminal.send_keys("touch /tmp/testabc\n")
        terminal.send_keys("touch /tmp/testabd\n")
        terminal.send_keys("ls /tmp/test*\n")
        elem = self.wait_xpath(
            "//*[contains(text(), '%s') and contains(text(), '%s')]" % ('/tmp/testabc', '/tmp/testabd'))
        self.assertTrue("/tmp/testabc" in elem.text)
        process.run("ls /tmp/testabc")
        terminal.send_keys("rm -f /tmp/testabc /tmp/testabd\n")
        process.run("ls /tmp/testabc |wc -l |grep 0", shell=True)
        self.mainframe()

if __name__ == '__main__':
    main()
