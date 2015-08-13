#!/usr/bin/python
""" SETUP tasks
curl https://copr.fedoraproject.org/coprs/lmr/Autotest/repo/epel-7/lmr-Autotest-epel-7.repo > /etc/yum.repos.d/lmr-Autotest-epel-7.repo
curl https://copr.fedoraproject.org/coprs/pkilambi/docker/repo/epel-7/pkilambi-docker-epel-7.repo > /etc/yum.repos.d/pkilambi-docker-epel-7.repo
curl https://copr.fedoraproject.org/coprs/sgallagh/cockpit-preview/repo/epel-7/sgallagh-cockpit-preview-epel-7.repo > /etc/yum.repos.d/sgallagh-cockpit-preview-epel-7.repo
yum  --nogpgcheck -y install http://dl.fedoraproject.org/pub/epel/7/x86_64/e/epel-release-7-5.noarch.rpm
yum  --nogpgcheck -y install python-pip avocado npm xorg-x11-server-Xvfb firefox cockpit 
npm install -g phantomjs
pip install selenium PyVirtualDisplay
adduser test
echo superhardpasswordtest5554 | passwd --stdin test
usermod -a -G wheel test

systemctl start cockpit

chown test.test /home/test/test.py

# under user:
sudo -u test bash -c 'Xvfb :99 -ac& sleep 2; export DISPLAY=:99; avocado run /home/test/test.py'

"""

import selenium.webdriver
from avocado import Test
from avocado import main
from avocado.utils import process
import time, os
import inspect

user="test"
passwd="superhardpasswordtest5554"
        
class BasicTestSuite(Test):
    def setUp(self):
        #self.driver = selenium.webdriver.PhantomJS(service_args=['--web-security=no','--ssl-protocol=any', '--ignore-ssl-errors=yes'])
        #self.driver=selenium.webdriver.Chrome()
        self.driver=selenium.webdriver.Firefox()
        self.driver.set_window_size(1024, 768)
        self.driver.set_page_load_timeout(20)
        self.driver.implicitly_wait(10)
        self.default_try=10
        self.default_sleep=1

    def tierDown(self):
        self.driver.quit()
        
    def wait(self,method,text):
        returned=None
        for foo in (0, self.default_try):
            try:
                returned=method(text)
                break
            except:
                print "."
                time.sleep(self.default_sleep)
                pass
        if returned == None:
            self.driver.get_screenshot_as_file("snapshot-%s.png" % str(inspect.stack()[1][3]))
            method(text)
        return method(text)
            
    def wait_id(self,el):
        return self.wait(self.driver.find_element_by_id, el)
        
    def wait_link(self,el):
        return self.wait(self.driver.find_element_by_partial_link_text, el)

    def wait_xpath(self,el):
        return self.wait(self.driver.find_element_by_xpath, el)
            
    def testBase(self):
        self.driver.get('https://localhost:9090')
        #self.log.debug(driver.page_source)
        elem=self.wait_id('server-name')
        out=process.run("hostname", shell=True)
        self.assertTrue(str(out.stdout)[:-1] in str(elem.text))
        self.driver.close()
        
    def testLogin(self):
        self.driver.get('https://localhost:9090')
        elem=self.wait_id('login-user-input')
        elem.send_keys(user)
        elem=self.wait_id('login-password-input')
        elem.send_keys(passwd)
        self.wait_id("login-button").click()
        
        elem=self.wait_id("content-user-name")
        self.assertEqual(elem.text,user)
        
        self.driver.close()
        
    def testLoginChangeTabNetworking(self):
        self.driver.get('https://localhost:9090')
        elem=self.wait_id('login-user-input')
        elem.send_keys(user)
        elem=self.wait_id('login-password-input')
        elem.send_keys(passwd)
        self.wait_id("login-button").click()
        
        elem=self.wait_id("content-user-name")
        self.assertEqual(elem.text,user)
        
        out=process.run("ip r |grep default | cut -d ' ' -f 5", shell=True)
        self.wait_link('Network').click()
        self.driver.switch_to_frame(self.wait_xpath("//iframe[@name='localhost/shell/shell']"))
        self.wait_id("networking-interfaces")
        self.wait_id("networking-tx-graph")
        
        elem=self.wait_xpath("//*[contains(text(), '%s')]" % out.stdout[:-1] )
        self.driver.switch_to_default_content()
        self.driver.close()

 
        
if __name__ == '__main__':
    main()
