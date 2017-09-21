#!/usr/bin/python2

# we need to be able to find and import seleniumlib, so add this directory
import os
import sys
machine_test_dir = os.path.dirname(os.path.abspath(__file__))
if not machine_test_dir in sys.path:
    sys.path.insert(1, machine_test_dir)

from avocado import main
from seleniumlib import *

class DockerTestSuite(SeleniumTest):
    """
    :avocado: enable
    """
    def test10ContainerTab(self):
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

if __name__ == '__main__':
    main()
