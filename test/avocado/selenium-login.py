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
javascript_clicks=True

visible = EC.visibility_of_element_located
clickable = EC.element_to_be_clickable
invisible = EC.invisibility_of_element_located
frame = EC.frame_to_be_available_and_switch_to_it

class BasicTestSuite(Test):

    def setUp(self):
        if not (os.environ.has_key("HUB") or os.environ.has_key("BROWSER")):
            self.driver = selenium.webdriver.Firefox()
            guest_machine = 'localhost'
        else:
            selenium_hub = os.environ["HUB"] if os.environ.has_key("HUB") else "localhost"
            browser = os.environ["BROWSER"] if os.environ.has_key("BROWSER") else "firefox"
            guest_machine = os.environ["GUEST"]
            self.driver = selenium.webdriver.Remote(
                command_executor='http://%s:4444/wd/hub' % selenium_hub, desired_capabilities={'browserName': browser})

        self.driver.set_window_size(1400, 1200)
        self.driver.set_page_load_timeout(90)
        self.default_try = 40
        # self.default_try is number of repeats for finding element
        self.default_explicit_wait = 1
        # self.default_explicit_wait is time for waiting for element
        # default_explicit_wait * default_try = max time for waiting for element
        self.driver.get('http://%s:9090' % guest_machine)
        self.error=True

    def tearDown(self):
        if self.error:
            screenshot_file=""
            try:
                screenshot_file="snapshot-teardown-%s.png" %  str(time.clock())
                # using time.clock() to ensure that snapshot files are unique and ordered
                self.driver.save_screenshot(screenshot_file)
                print "Screenshot done in teardown phase: " + screenshot_file
            except Exception as e:
                screenshot_file="Unable to catch screenshot: " + screenshot_file
                raise Exception('ERR: Unable to store screenshot: %s' % screenshot_file, str(e))
        try:
            self.driver.close()
            self.driver.quit()
        except Exception as e:
            raise Exception('ERR: Unable to close WEBdriver', str(e))

    def click(self,element):
        if javascript_clicks:
            self.driver.execute_script("arguments[0].click();", element)
        else:
            element.click()

    def wait(self, method, text, baseelement, overridetry, fatal, cond):
        """
parameters:
    method - used selenim method method
    text - what are you searching for
    baseelement - use some element as root of tree, not self.driver
    overridetry - change value of repeats
    fatal - boolean if search is fatal or notice
    cond - use selenim conditions (aliases are defined above class)
        """
        if not baseelement:
            baseelement = self.driver
        returned = None
        cond = cond if cond else visible
        internaltry = overridetry if overridetry else self.default_try
        for foo in range(0, internaltry):
            try:
                returned = WebDriverWait(baseelement, self.default_explicit_wait).until(cond((method, text)))
                if returned:
                    break
            except:
                pass
        if returned is None:
            if fatal:
                screenshot_file = "snapshot-%s-%s-lines_%s.png" % (str(inspect.stack()[1][3]), str(inspect.stack(
                )[2][3]), '-'.join([str(x[2]) for x in inspect.stack() if inspect.stack()[0][1] == x[1]]))
                additional_text=""
                try:
                    self.driver.save_screenshot(screenshot_file)
                    self.error=False
                except:
                    screenshot_file="Unable to catch screenshot: " + screenshot_file
                    pass
                finally:
                    raise Exception('ERR: Unable to locate name: %s' % str(text), screenshot_file)
        return returned

    def wait_id(self, el, baseelement=None, overridetry=None, fatal=True, cond=None):
        return self.wait(By.ID, text=el, baseelement = baseelement, overridetry=overridetry, fatal=fatal, cond=cond)

    def wait_link(self, el, baseelement=None, overridetry=None, fatal=True, cond=None):
        return self.wait(By.PARTIAL_LINK_TEXT, baseelement = baseelement, text=el, overridetry=overridetry, fatal=fatal, cond=cond)

    def wait_xpath(self, el, baseelement=None, overridetry=None, fatal=True, cond=None):
        return self.wait(By.XPATH, text=el, baseelement = baseelement, overridetry=overridetry, fatal=fatal, cond=cond)

    def wait_text(self, el, nextel="", element="*", baseelement=None, overridetry=None, fatal=True, cond=None):
        search_string=""
        search_string_next=""
        elem=None
        for foo in el.split():
            if search_string == "":
                search_string = search_string + 'contains(text(), "%s")' % foo
            else:
                search_string=search_string + ' and contains(text(), "%s")' % foo
        for foo in nextel.split():
            if search_string_next == "":
                search_string_next = search_string_next + 'contains(text(), "%s")' % foo
            else:
                search_string_next = search_string_next + ' and contains(text(), "%s")' % foo
        if nextel:
            elem = self.wait_xpath("//%s[%s]/following-sibling::%s[%s]" % (element, search_string, element, search_string_next), baseelement = baseelement, overridetry=overridetry, fatal=fatal, cond=cond)
        else:
            elem = self.wait_xpath("//%s[%s]" % (element, search_string), baseelement = baseelement, overridetry=overridetry, fatal=fatal, cond=cond)
        return elem
    
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
        self.click(self.wait_id("login-button", cond=clickable))

    def logout(self):
        self.click(self.wait_id('navbar-dropdown', cond=clickable))
        self.click(self.wait_id('go-logout', cond=clickable))

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
        elem = self.wait_id('containers')
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
