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
docker run -d -p 4444:4444 --name selenium-hub selenium/hub:3
docker run -d --link selenium-hub:hub selenium/node-chrome:3
docker run -d --link selenium-hub:hub selenium/node-firefox:3

systemctl start cockpit

# RUN AS
avocado run selenium-login.py
# OR ALTERNATIVELY with docker selenium server (BROWSER=firefox or chrome)
HUB=localhost BROWSER=chrome GUEST=`hostname -i` avocado run selenium-login.py
"""

import inspect
import selenium.webdriver
from selenium.common.exceptions import WebDriverException
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
import os
import time
from avocado import Test
from timeoutlib import Retry
from machine_core import ssh_connection

user = "test"
passwd = "superhardpasswordtest5554"

# path for storing selenium screenshots
actualpath = "."
IDENTITY_FILE = "identity"

# use javascript to generate clicks in the browsers and add more javascript checks for elements
# this prevents races where the test clicks in the wrong place because the page layout changed
javascript_operations = True

visible = EC.visibility_of_element_located
clickable = EC.element_to_be_clickable
invisible = EC.invisibility_of_element_located
frame = EC.frame_to_be_available_and_switch_to_it

class SeleniumTest(Test):
    """
    :avocado: disable
    """
    def setUp(self):
        selenium_hub = os.environ.get("HUB", "localhost")
        browser = os.environ.get("BROWSER", "firefox")
        guest_machine = os.environ.get("GUEST", "localhost")
        network_port = int(os.environ.get("PORT", "9090"))
        url_base = os.environ.get("URL_BASE", "http")
        local_testing = os.environ.get("LOCAL", "no")  # use "yes" to test via local browsers
        identity_file = os.environ.get("IDENTITY")
        if not identity_file:
            identity_file = os.path.realpath(os.path.join(os.path.dirname(os.path.realpath(__file__)), IDENTITY_FILE))
        if not os.path.exists(identity_file):
            raise FileNotFoundError("IDENTITY envvar does not contain file to proper private key,"
                                    " or {} file does not exist".format(identity_file))
        self.ssh_identity_file = identity_file
        self.machine = ssh_connection.SSHConnection(user=user,
                                                    address=guest_machine,
                                                    ssh_port=22,
                                                    identity_file=identity_file,
                                                    verbose=False)
        if browser == 'edge':
            browser = 'MicrosoftEdge'
        # allow_localhost testing
        if local_testing == "yes":
            if browser == "firefox":
                self.driver = selenium.webdriver.Firefox()
            elif browser == "chrome":
                self.driver = selenium.webdriver.Chrome()
            elif browser == 'MicrosoftEdge':
                self.driver = selenium.webdriver.Edge()
        else:
            @Retry(attempts=3, timeout=30,
                   exceptions=(WebDriverException,),
                   error=Exception('Timeout: Unable to attach remote Browser on hub'))
            def connect_browser():
                self.driver = selenium.webdriver.Remote(command_executor='http://%s:4444/wd/hub' % selenium_hub,
                                                        desired_capabilities={'browserName': browser})

            connect_browser()
        self.driver.set_window_size(1400, 1200)
        self.driver.set_page_load_timeout(90)
        # self.default_try is number of repeats for finding element
        self.default_try = 40
        # stored search function for each element to be able to refresh element in case of detached from DOM
        self.element_wait_functions = {}
        # self.default_explicit_wait is time for waiting for element
        # default_explicit_wait * default_try = max time for waiting for element
        self.default_explicit_wait = 1

        @Retry(attempts=3, timeout=30,
               exceptions=(WebDriverException,),
               error=Exception('Timeout: Unable to get page'))
        def connectwebpage():
            self.driver.get('%s://%s:%s' % (url_base, guest_machine, network_port))

        connectwebpage()

        # if self.error evaluates to True when a test finishes,
        # an error is raised and a screenshot generated
        self.error = True

    def tearDown(self):
        if self.error:
            screenshot_file = ""
            try:
                # use time.clock() to ensure that snapshot files are unique and ordered
                # sample name is like: screenshot-teardown-172434.png
                screenshot_file = "screenshotTeardown%s.png" % str(time.clock())[2:]

                self.driver.save_screenshot(os.path.join(actualpath,screenshot_file))
                self.log.error("Screenshot(teardown) - Wrote: " + screenshot_file)
                self.get_debug_logs()
            except Exception as e:
                screenshot_file = "Unable to catch screenshot: {0}".format(screenshot_file)
                raise Exception('ERR: Unable to store screenshot: %s' % screenshot_file, str(e))
        try:
            self.driver.close()
            self.driver.quit()
        except Exception as e:
            self.get_debug_logs()
            if self.error:
                raise Exception('ERR: Unable to close WEBdriver', str(e))
            else:
                self.log.info('ERR: Unable to close WEBdriver: {0}'.format(e))

    def get_debug_logs(self, logs=None):
        if logs is None:
            logs = ['browser', 'driver', 'client', 'server']
        try:
            max_line_log_count = 10
            for log in logs:
                receivedlog = [x for x in self.driver.get_log(log)][-max_line_log_count:]
                if receivedlog:
                    self.log.info(">>>>> " + log)
                    for line in receivedlog:
                        self.log.info("      {0}".format(line))
        except WebDriverException as e:
            self.log.info("ERR: Unable to get logs: " + e.msg)

    def everything_loaded(self, element):
        """
This function is only for internal purposes:
    It via javascript check that attribute data-loaded is in element
        """
        if javascript_operations:
            return self.driver.execute_script("return arguments[0].getAttribute('data-loaded')", element)
        else:
            return True

    def click(self, element):
        failure = "CLICK: too many tries"
        usedfunction = self.element_wait_functions[element] if element in self.element_wait_functions else None
        for foo in range(0, self.default_try):
            try:
                if javascript_operations:
                    self.driver.execute_script("arguments[0].click();", element)
                else:
                    element.click()
                failure = None
                break
            except Exception as e:
                failure = e
                pass
            try:
                element = usedfunction() if usedfunction else element
                self.everything_loaded(element)
            except:
                pass
        if failure:
            raise Exception('ERR: Unable to CLICK on element ', str(failure))

    def send_keys(self, element, text, clear = True):
        if clear:
            element.clear()
        element.send_keys(text)
        if javascript_operations:
            self.driver.execute_script('var ev = document.createEvent("Event"); ev.initEvent("change", true, false); arguments[0].dispatchEvent(ev);', element)
            self.driver.execute_script('var ev = document.createEvent("Event"); ev.initEvent("keydown", true, false); arguments[0].dispatchEvent(ev);', element)

    def check_box(self, element, checked=True):
        if element.get_attribute('checked') != checked:
            element.click()

    def wait(self, method, text, baseelement, overridetry, fatal, cond, jscheck):
        """
This function is low level, tests should prefer to use the wait_* functions:
    This function stores caller function for this element to an internal dictionary, in case that
    element is lost and has to be renewed (-> self.element_wait_functions)
parameters:
    method - used selenium method
    text - what are you searching for
    baseelement - use some element as root of tree, not self.driver
    overridetry - change value of repeats
    fatal - boolean if search is fatal or notice
    cond - use selenium conditions (aliases are defined above class)
    jscheck - use javascipt to wait for element has attribute-data loaded, it is safer, but slower
        """
        if not baseelement:
            baseelement = self.driver
        returned = None
        cond = cond if cond else visible
        internaltry = overridetry if overridetry else self.default_try
        usedfunction = lambda :WebDriverWait(baseelement, self.default_explicit_wait).until(cond((method, text)))
        for foo in range(0, internaltry):
            try:
                returned = usedfunction()
                if jscheck:
                    if not (cond == frame or fatal == False or cond == invisible) and self.everything_loaded(returned):
                        break
                else:
                    break
            except:
                pass
        if returned is None:
            if fatal:
                # sample screenshot name is: screenshot-test20Login.png
                # it stores super caller method to name via inspection code stack
                screenshot_file = "screenshot%s.png" % str(inspect.stack()[2][3])
                try:
                    self.driver.save_screenshot(os.path.join(actualpath,screenshot_file))
                    self.error = False
                except Exception as e:
                    screenshot_file = "Unable to catch screenshot: {0} ({1})".format(screenshot_file, e)
                    pass
                finally:
                    self.log.error("Screenshot(test) - Wrote: " + screenshot_file)
                    self.get_debug_logs()
                    raise Exception('ERR: Unable to locate name: %s' % str(text), screenshot_file)
        self.element_wait_functions[returned] = usedfunction
        return returned

    def wait_id(self, el, baseelement=None, overridetry=None, fatal=True, cond=None, jscheck=False):
        return self.wait(By.ID, text=el, baseelement=baseelement, overridetry=overridetry, fatal=fatal, cond=cond, jscheck=jscheck)

    def wait_link(self, el, baseelement=None, overridetry=None, fatal=True, cond=None, jscheck=False):
        return self.wait(By.PARTIAL_LINK_TEXT, baseelement=baseelement, text=el, overridetry=overridetry, fatal=fatal, cond=cond, jscheck=jscheck)

    def wait_xpath(self, el, baseelement=None, overridetry=None, fatal=True, cond=None, jscheck=False):
        return self.wait(By.XPATH, text=el, baseelement=baseelement, overridetry=overridetry, fatal=fatal, cond=cond, jscheck=jscheck)

    def wait_text(self, el, nextel="", element="*", baseelement=None, overridetry=None, fatal=True, cond=None, jscheck=False):
        search_string = ""
        search_string_next = ""
        elem = None
        for foo in el.split():
            if search_string == "":
                search_string = search_string + 'contains(text(), "%s")' % foo
            else:
                search_string = search_string + ' and contains(text(), "%s")' % foo
        for foo in nextel.split():
            if search_string_next == "":
                search_string_next = search_string_next + 'contains(text(), "%s")' % foo
            else:
                search_string_next = search_string_next + ' and contains(text(), "%s")' % foo
        if nextel:
            elem = self.wait_xpath("//%s[%s]/following-sibling::%s[%s]" % (element, search_string, element, search_string_next), baseelement=baseelement, overridetry=overridetry, fatal=fatal, cond=cond, jscheck=jscheck)
        else:
            elem = self.wait_xpath("//%s[%s]" % (element, search_string), baseelement=baseelement, overridetry=overridetry, fatal=fatal, cond=cond, jscheck=jscheck)
        return elem

    def wait_frame(self, el, baseelement=None, overridetry=None, fatal=True, cond=None, jscheck=False):
        text = "//iframe[contains(@name,'%s')]" % el
        return self.wait(By.XPATH, text=text, baseelement=baseelement, overridetry=overridetry, fatal=fatal, cond=frame, jscheck=jscheck)

    def mainframe(self):
        self.driver.switch_to.default_content()

    def login(self, tmpuser=user, tmppasswd=passwd, wait_hostapp=True, add_ssh_key=True):
        self.send_keys(self.wait_id('login-user-input'), tmpuser)
        self.send_keys(self.wait_id('login-password-input'), tmppasswd)
        self.check_box(self.wait_id('authorized-input'))
        self.click(self.wait_id("login-button", cond=clickable))
        if wait_hostapp:
            self.wait_id("host-apps")
        if add_ssh_key:
            self.add_authorised_ssh_key_to_user()

    def add_authorised_ssh_key_to_user(self, pub_key=None):
        if pub_key is None:
            pub_key = self.ssh_identity_file
        ssh_public_key = open("%s.pub" % pub_key).read()
        ssh_key_name = ssh_public_key.rsplit(" ", 1)[1]
        self.click(self.wait_id("content-user-name", cond=clickable))
        self.click(self.wait_id("go-account", cond=clickable))
        self.wait_frame('users')
        # put key just in case it is not already there
        if not self.wait_xpath("//div[@class='comment' and contains(text(), '%s')]" % ssh_key_name,
                               fatal=False,
                               overridetry=3,
                               cond=visible):
            self.click(self.wait_id("authorized-key-add", cond=clickable))
            self.send_keys(self.wait_id("authorized-keys-text", cond=visible), ssh_public_key)
            self.click((self.wait_id("add-authorized-key", cond=clickable)))
            self.wait_id("authorized-key-add", cond=clickable)
        self.driver.switch_to.default_content()

    def logout(self):
        self.driver.switch_to.default_content()
        self.click(self.wait_id('navbar-dropdown', cond=clickable))
        self.click(self.wait_id('go-logout', cond=clickable))
