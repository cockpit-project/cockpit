#!/usr/bin/python3

# we need to be able to find and import seleniumlib, so add this directory
from testlib_avocado.seleniumlib import SeleniumTest, clickable
from testlib_avocado import libdisc
import os
import sys
machine_test_dir = os.path.dirname(os.path.abspath(__file__))
if machine_test_dir not in sys.path:
    sys.path.insert(1, machine_test_dir)


class StorageTestSuite(SeleniumTest):
    """
    :avocado: enable
    """

    def test10Storage(self):
        self.login()
        other_disc = libdisc.DiscSimple(self.machine)
        other_discname = other_disc.adddisc("d1")
        other_shortname = os.path.basename(other_discname)
        self.click(self.wait_link('Storage', cond=clickable))
        self.wait_frame("storage")
        self.wait_id("drives")
        self.click(self.wait_xpath("//*[@data-testkey='%s']" % other_shortname, cond=clickable))
        self.wait_id('storage-detail')
        self.wait_text(other_discname, element="div")
        self.wait_text("Capacity", element="label")
        self.wait_text("1000 MiB", element="span")
        self.click(self.wait_link('Storage', cond=clickable))
        self.wait_xpath("//*[@data-testkey='%s']" % other_shortname)
        self.mainframe()
