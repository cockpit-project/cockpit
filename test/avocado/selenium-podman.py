#!/usr/bin/python3

# we need to be able to find and import seleniumlib, so add this directory
from testlib_avocado.seleniumlib import SeleniumTest, clickable, invisible
import os
import sys
machine_test_dir = os.path.dirname(os.path.abspath(__file__))
if machine_test_dir not in sys.path:
    sys.path.insert(1, machine_test_dir)


class PodmanTestSuite(SeleniumTest):
    """
    :avocado: enable
    """

    def test10ContainerTab(self):
        self.login()
        self.click(self.wait_link('Podman Containers', cond=clickable))
        self.wait_frame("podman")
        # Start podman button problematic
        if self.wait_text("Start podman", fatal=False, overridetry=5, cond=clickable):
            self.click(self.wait_xpath("//button[@class='btn btn-primary btn-lg']", cond=clickable))
        self.wait_id('containers-containers')
        self.wait_id('containers-images')
        # Search for container and cancel
        self.click(self.wait_link('Get new image', cond=clickable))
        self.wait_xpath(
            "//button[@class='btn btn-primary' and @disabled and text()='Download']")
        self.send_keys(self.wait_id('search-image-dialog-name'), "fedora")
        self.wait_xpath("//div[@class='list-group']")
        self.wait_xpath("//div[text()='Official Docker builds of Fedora']")
        self.click(self.wait_xpath(
            "//button[@class='btn-cancel btn btn-default' and text()='Cancel']", cond=clickable))
        self.wait_id('search-image-dialog-name', cond=invisible)
        # Search for container and download it
        self.click(self.wait_link('Get new image', cond=clickable))
        self.wait_xpath(
            "//button[@class='btn btn-primary' and @disabled and text()='Download']")
        self.send_keys(self.wait_id('search-image-dialog-name'), "cockpit")
        self.wait_xpath("//div[@class='list-group']")
        self.click(self.wait_xpath(
            "//div[ @class='image-list-item' and contains(div,'Cockpit Web Ser')]", cond=clickable))
        self.click(self.wait_xpath(
            "//div[@class='modal-footer']//button[@class='btn btn-primary']", cond=clickable))
        self.wait_id('search-image-dialog-name', cond=invisible)
        # Remove container
        self.click(self.wait_xpath(
            "//tr[@class='listing-ct-item listing-ct-nonavigate' and contains(th, 'cockpit/ws')]",
            cond=clickable))
        self.wait_xpath("//tbody[@class='open']")
        self.click(self.wait_xpath(
            "//tbody[@class='open']/tr/td/div/div//button[@class='btn btn-danger btn-delete pficon pficon-delete']",
            cond=clickable))
        self.wait_text('Are you sure')
        self.click(self.wait_id('btn-img-delete', cond=clickable))
        self.wait_xpath(
            "//tr[@class='listing-ct-item listing-ct-nonavigate' and contains(th, 'cockpit/ws')]",
            cond=invisible)
        # Done
        self.mainframe()
