#!/usr/bin/python2

# we need to be able to find and import seleniumlib, so add this directory
import os
import sys
machine_test_dir = os.path.dirname(os.path.abspath(__file__))
if not machine_test_dir in sys.path:
    sys.path.insert(1, machine_test_dir)

from avocado import main
import libdisc
from seleniumlib import *

class StorageTestSuite(SeleniumTest):
    """
    :avocado: enable
    """
    def test10Storage(self):
        other_disc = libdisc.DiscSimple()
        other_discname = other_disc.adddisc("d1")
        other_shortname = os.path.basename(other_discname)
        self.login()
        self.wait_id("host-apps")
        self.click(self.wait_link('Storage', cond=clickable))
        self.wait_frame("storage")
        self.wait_id("drives")
        self.click(self.wait_xpath("//*[@data-testkey='%s']" % other_shortname, cond=clickable))
        self.wait_id('storage-detail')
        self.wait_text(other_discname, element="td")
        self.wait_text("Capacity", element="td")
        self.wait_text("1000 MiB", element="td")
        self.click(self.wait_link('Storage', cond=clickable))
        self.wait_xpath("//*[@data-testkey='%s']" % other_shortname)
        self.mainframe()
        self.error=False

if __name__ == '__main__':
    main()
