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
import logging
import selenium.webdriver
from selenium.common.exceptions import WebDriverException
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.select import Select
from selenium.webdriver.remote.remote_connection import LOGGER
import os
import time
import subprocess
from avocado import Test
from .timeoutlib import Retry
from .machine_core import ssh_connection
from .exceptions import SeleniumFailure, SeleniumDriverFailure, SeleniumElementFailure,\
    SeleniumScreenshotFailure, SeleniumJSFailure

user = "test"
passwd = "superhardpasswordtest5554"

# path for storing selenium screenshots
actualpath = "."
IDENTITY_FILE = "identity"

LOGGER.setLevel(logging.WARNING)

# use javascript to generate clicks in the browsers and add more javascript checks for elements
# this prevents races where the test clicks in the wrong place because the page layout changed
javascript_operations = True

visible = EC.visibility_of_element_located
clickable = EC.element_to_be_clickable
invisible = EC.invisibility_of_element_located
frame = EC.frame_to_be_available_and_switch_to_it
present = EC.presence_of_element_located
text_in = EC.text_to_be_present_in_element


class SeleniumTest(Test):
    """
    :avocado: disable
    """

    RETRY_LOOP_SLEEP = 0.5
    PAGE_LOAD_TIMEOUT = 120
    PAGE_SIZE = [1400, 1200]

    def _selenium_logging(self, method, *args):
        transformed_arg_list = list()
        for arg in args:
            if "selenium.webdriver.support.expected_conditions" in str(arg):
                transformed_arg_list.append(arg.__name__)
            elif isinstance(arg, selenium.webdriver.remote.webelement.WebElement):
                transformed_arg_list.append(arg.get_attribute('outerHTML').split(">", 1)[0] + ">")
            else:
                transformed_arg_list.append(str(arg))
        self.log.info("SELENIUM {}: ".format(method) + " ".join(transformed_arg_list))

    def setUp(self):
        selenium_hub = os.environ.get("HUB", "localhost")
        browser = os.environ.get("BROWSER", "firefox")
        guest_machine = os.environ.get("GUEST", "localhost")
        network_port = int(os.environ.get("PORT", "9090"))
        # ssh_adress is impotant for running inside CI for debugging purposes
        ssh_adress = os.environ.get("SSH_GUEST", guest_machine)
        ssh_port = int(os.environ.get("SSH_PORT", "22"))
        url_base = os.environ.get("URL_BASE", "http")
        local_testing = os.environ.get("LOCAL", "no")  # use "yes" to test via local browsers
        identity_file = os.environ.get("IDENTITY")
        if not identity_file:
            identity_file = os.path.realpath(os.path.join(os.path.dirname(os.path.realpath(__file__)), IDENTITY_FILE))
        if not os.path.exists(identity_file):
            raise FileNotFoundError("IDENTITY envvar does not contain file to proper private key,"
                                    " or {} file does not exist".format(identity_file))
        # ensure that private key has proper file attributes
        os.chmod(identity_file, 0o600)
        self.ssh_identity_file = identity_file
        self.machine = ssh_connection.SSHConnection(user=user,
                                                    address=ssh_adress,
                                                    ssh_port=ssh_port,
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
                   error=SeleniumDriverFailure('Timeout: Unable to attach remote Browser on hub'))
            def connect_browser():
                self.driver = selenium.webdriver.Remote(command_executor='http://%s:4444/wd/hub' % selenium_hub,
                                                        desired_capabilities={'browserName': browser})

            connect_browser()
        self.driver.set_window_size(*self.PAGE_SIZE)
        self.driver.set_page_load_timeout(self.PAGE_LOAD_TIMEOUT)
        # self.default_try is number of repeats for finding element
        self.default_try = 40
        # stored search function for each element to be able to refresh element in case of detached from DOM
        self.element_wait_functions = {}
        # self.default_explicit_wait is time for waiting for element
        # default_explicit_wait * default_try = max time for waiting for element
        self.default_explicit_wait = 1

        @Retry(attempts=3, timeout=30,
               exceptions=(WebDriverException,),
               error=SeleniumFailure('Timeout: Unable to get page'))
        def connectwebpage():
            self.driver.get('%s://%s:%s' % (url_base, guest_machine, network_port))

        connectwebpage()

    def _get_screenshot_name(self, *args):
        sep = "-"
        if len(args) > 0:
            suffix = sep.join(args)
        else:
            datesuffix = str(time.process_time())[2:]
            if inspect and inspect.stack() and len(inspect.stack()) > 0:
                stackinfo = [x[3] for x in inspect.stack() if x[3].startswith("test") or x[3] in ["tearDown", "setUp"]]
            else:
                stackinfo = []
            suffix = (str(sep.join(stackinfo)) + sep if stackinfo else "") + datesuffix
        return "screenshot{}{}.png".format(sep, suffix)

    def take_screenshot(self, filename=None, phase="", fatal=True, get_debug_logs_if_fail=True, relative_path=actualpath):
        if not filename:
            filename = self._get_screenshot_name()
        try:
            self.driver.save_screenshot(os.path.join(relative_path, filename))
            self.log.info("Screenshot({}) - Wrote: {}".format(phase, filename))

            # get HTML page output for better debugging of issues
            html_file_path = os.path.join(relative_path, filename + ".html")
            with open(html_file_path, 'w') as output:
                output.write(self.driver.page_source)
                self.log.info("Html page content dump ({}) - Wrote: {}".format(phase, html_file_path))
        except WebDriverException as e:
            msg = 'Unable to store ({}) screenshot: {} (Exception: {})'.format(phase, filename, e)
            if get_debug_logs_if_fail:
                self.get_debug_logs()
            if fatal:
                raise SeleniumScreenshotFailure(msg)
            else:
                self.log.info(msg)

    def tearDown(self):
        # take screenshot every time to ensure that if test fails there will be debugging info
        # in case it assert in some condition, not directly inside elements
        # and logic of when transfer images is up to scheduler
        self.take_screenshot(phase="{}-tearDown".format(self.id()), fatal=False)
        try:
            self.driver.quit()
        except WebDriverException as e:
            self.log.info('Unable to quit WEBdriver: {0}'.format(e))

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

    def execute_script(self, *args, fatal=True):
        self._selenium_logging("execute javascript", *args)
        try:
            return self.driver.execute_script(*args)
        except WebDriverException as e:
            msg = "Unable to execute JavaScript code: {} ({})".format(args, e)
            if fatal:
                self.take_screenshot(fatal=False)
                raise SeleniumJSFailure(msg)
            else:
                self.log.info(msg)

    def click(self, element):
        failure = "CLICK: too many tries"
        usedfunction = self.element_wait_functions[element] if element in self.element_wait_functions else None
        for retry in range(0, self.default_try):
            try:
                if retry > 0 and usedfunction:
                    element = usedfunction()
                self._selenium_logging("click", element)
                if javascript_operations:
                    self.driver.execute_script("arguments[0].click();", element)
                else:
                    element.click()
                failure = None
                break
            except WebDriverException as e:
                failure = e
            time.sleep(self.RETRY_LOOP_SLEEP)

        if failure:
            self.take_screenshot(fatal=False)
            raise SeleniumElementFailure('Unable to CLICK on element {}'.format(failure))

    def send_keys(self, element, text, clear=True, ctrla=False):
        self._selenium_logging("send keyboard input", "{} to:".format(text), element)
        try:
            if clear:
                element.clear()
            if ctrla:
                element.send_keys(Keys.CONTROL + 'a')
            element.send_keys(text)
        except WebDriverException as e:
            self.take_screenshot(fatal=False)
            raise SeleniumElementFailure('Unable to SEND_KEYS to element ({})'.format(e))
        if javascript_operations:
            self.execute_script('var ev = new Event("change", { bubbles: true, cancelable: false }); arguments[0].dispatchEvent(ev);', element)
            self.execute_script('var ev = new Event("change", { bubbles: true, cancelable: false }); arguments[0].dispatchEvent(ev);', element)

    def check_box(self, element, checked=True):
        self._selenium_logging("check box select", element)
        try:
            if element.is_selected() != checked:
                element.click()
        except WebDriverException as e:
            self.take_screenshot(fatal=False)
            raise SeleniumElementFailure('Unable to CHECKBOX element ({})'.format(e))

    def _relocate_element(self, element):
        try:
            if element in self.element_wait_functions:
                element = self.element_wait_functions[element]()
        except (WebDriverException, SeleniumFailure):
            pass
        self._selenium_logging("element relocation", element)
        return element

    def select(self, element, select_function, value=None):
        failure = "Select: too many tries"
        output = None
        methods = [item for item in dir(Select) if not item.startswith("_")]
        if select_function not in methods:
            raise AttributeError("You used bad parameter for selected_function param, allowed are %s" % methods)
        self._selenium_logging("select", select_function, "for:", element, "via:", value)
        for _ in range(self.default_try):
            try:
                s1 = Select(element)
                select_function_temp = getattr(s1, select_function)
                if value is None:
                    output = select_function_temp()
                else:
                    output = select_function_temp(value)
                failure = None
                break
            except WebDriverException as e:
                failure = e
            element = self._relocate_element(element)
        if failure:
            self.take_screenshot(fatal=False)
            raise SeleniumElementFailure("Unable to Select in element %s" % failure)
        return output

    def select_by_text(self, element, value):
        return self.select(element=element, select_function="select_by_visible_text", value=value)

    def select_by_value(self, element, value):
        return self.select(element=element, select_function="select_by_value", value=value)

    def wait(self, method, text, baseelement, overridetry, fatal, cond, wait_data_loaded, text_, reversed_cond=False):
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
    wait_data_loaded - use javascript to wait for element has attribute-data loaded; ONLY applies to cockpit page <iframe>s
    text_ - text to be present in element
        """
        if not baseelement:
            baseelement = self.driver
        returned = None
        cond = cond if cond else visible
        if cond is text_in:
            condition = cond((method, text), text_)
        else:
            condition = cond((method, text))
        internaltry = overridetry if overridetry else self.default_try

        def usedfunction():
            if reversed_cond:
                return WebDriverWait(baseelement, self.default_explicit_wait).until_not(condition)
            return WebDriverWait(baseelement, self.default_explicit_wait).until(condition)

        for foo in range(0, internaltry):
            try:
                self._selenium_logging("element lookup",
                                       method,
                                       ":",
                                       text,
                                       cond,
                                       "(reverse cond)" if reversed_cond else "",
                                       "(text inside:{} is fatal:{}, wait data-loaded:{})".format(text_, fatal, wait_data_loaded))
                if foo > 0:
                    self._selenium_logging("element lookup retry {}".format(foo))
                returned = usedfunction()
                if wait_data_loaded and isinstance(returned, selenium.webdriver.remote.webelement.WebElement):
                    if self.driver.execute_script("return arguments[0].getAttribute('data-loaded')", returned):
                        break
                    self.log.info("element does not yet have data-loaded=1, retrying")
                else:
                    break
            except WebDriverException:
                pass
            time.sleep(self.RETRY_LOOP_SLEEP)
        if returned is None:
            if fatal:
                self.take_screenshot(fatal=False)
                raise SeleniumElementFailure('Unable to locate name: {}'.format(text))
        self.element_wait_functions[returned] = usedfunction
        return returned

    def wait_id(self, el, baseelement=None, overridetry=None, fatal=True, cond=None, text_=None, reversed_cond=False):
        return self.wait(By.ID, text=el, baseelement=baseelement, overridetry=overridetry, fatal=fatal, cond=cond, wait_data_loaded=False, text_=text_, reversed_cond=reversed_cond)

    def wait_link(self, el, baseelement=None, overridetry=None, fatal=True, cond=None, text_=None, reversed_cond=False):
        return self.wait(By.PARTIAL_LINK_TEXT, baseelement=baseelement, text=el, overridetry=overridetry, fatal=fatal, cond=cond, wait_data_loaded=False, text_=text_, reversed_cond=reversed_cond)

    def wait_css(self, el, baseelement=None, overridetry=None, fatal=True, cond=None, text_=None, reversed_cond=False):
        return self.wait(By.CSS_SELECTOR, text=el, baseelement=baseelement, overridetry=overridetry, fatal=fatal, cond=cond, wait_data_loaded=False, text_=text_, reversed_cond=reversed_cond)

    def wait_xpath(self, el, baseelement=None, overridetry=None, fatal=True, cond=None, text_=None, reversed_cond=False):
        return self.wait(By.XPATH, text=el, baseelement=baseelement, overridetry=overridetry, fatal=fatal, cond=cond, wait_data_loaded=False, text_=text_, reversed_cond=reversed_cond)

    def wait_text(self, el, nextel="", element="*", baseelement=None, overridetry=None, fatal=True, cond=None, reversed_cond=False):
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
            elem = self.wait_xpath("//%s[%s]/following-sibling::%s[%s]" % (element, search_string, element, search_string_next), baseelement=baseelement, overridetry=overridetry, fatal=fatal, cond=cond, reversed_cond=reversed_cond)
        else:
            elem = self.wait_xpath("//%s[%s]" % (element, search_string), baseelement=baseelement, overridetry=overridetry, fatal=fatal, cond=cond, reversed_cond=reversed_cond)
        return elem

    def wait_frame(self, el, baseelement=None, overridetry=None, fatal=True, cond=None, reversed_cond=False):
        text = "//iframe[contains(@name,'%s')]" % el
        return self.wait(By.XPATH, text=text, baseelement=baseelement, overridetry=overridetry, fatal=fatal, cond=frame, wait_data_loaded=True, text_=None, reversed_cond=reversed_cond)

    def mainframe(self):
        self._selenium_logging("return to main frame")
        try:
            self.driver.switch_to.default_content()
        except WebDriverException as e:
            self.get_debug_logs()
            raise SeleniumDriverFailure('Unable to return to main web context ({})'.format(e))

    def login(self, tmpuser=user, tmppasswd=passwd, wait_hostapp=True, add_ssh_key=True, authorized=True):
        self.send_keys(self.wait_id('login-user-input'), tmpuser)
        self.send_keys(self.wait_id('login-password-input'), tmppasswd)
        self.execute_script('window.localStorage.setItem("superuser:%s", "%s");' % (tmpuser, "any" if authorized else "none"))
        self.click(self.wait_id("login-button", cond=clickable))
        if wait_hostapp:
            self.wait_id("host-apps")
        if add_ssh_key and not self.check_machine_execute():
            self.add_authorised_ssh_key_to_user(user=tmpuser)

    def add_authorised_ssh_key_to_user(self, pub_key=None, user=user):
        if pub_key is None:
            pub_key = self.ssh_identity_file
        ssh_public_key = open("%s.pub" % pub_key).read()

        # When we are called, self.machine.ssh_user is usually the
        # "test" user, but that user can't log in yet via SSH until we
        # have added the key here. Thus, we temporarily switch to
        # "root" for the copy.
        #
        # (It would be nice if self.machine.execute had a "user"
        # parameter, but it's probably not worth changing that just
        # for this fringe use case here.)

        old_ssh_user = self.machine.ssh_user
        self.machine.ssh_user = "root"
        self.machine.execute("mkdir -p /home/%s/.ssh/ && echo '%s' >>/home/%s/.ssh/authorized_keys" % (user, ssh_public_key, user))
        self.machine.ssh_user = old_ssh_user

    def logout(self):
        self.mainframe()
        self.click(self.wait_id('navbar-dropdown', cond=clickable))
        self.click(self.wait_id('go-logout', cond=clickable))

    def check_machine_execute(self, timeout=5, machine=None):
        if not machine:
            machine = self.machine
        try:
            machine.execute(command="true", direct=True, timeout=timeout)
        except (subprocess.CalledProcessError, RuntimeError):
            return False
        return True

    def refresh(self, page_frame=None, frame_element_activation=None):
        self.driver.refresh()
        if frame_element_activation:
            self.click(frame_element_activation)
        if page_frame:
            self.wait_frame(page_frame)

    def prepare_machine_execute(self, tmpuser=user, tmppassword=passwd, ssh_adress=None, ssh_port=None, identity_file=None, verbose=None):
        """
        return machine and add key there if  necessary via cockpit UI,
        """
        machine = ssh_connection.SSHConnection(user=user,
                                               address=ssh_adress or self.machine.ssh_address,
                                               ssh_port=ssh_port or self.machine.ssh_port,
                                               identity_file=identity_file or self.machine.identity_file,
                                               verbose=verbose or self.machine.verbose
                                               )

        if not self.check_machine_execute(machine=machine):
            self.login(tmpuser=tmpuser, tmppasswd=tmppassword)
            self.logout()
            return machine
        return self.machine
