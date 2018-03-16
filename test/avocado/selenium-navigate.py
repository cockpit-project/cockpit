#!/usr/bin/python2

# we need to be able to find and import seleniumlib, so add this directory
import os
import sys

machine_test_dir = os.path.dirname(os.path.abspath(__file__))
if not machine_test_dir in sys.path:
    sys.path.insert(1, machine_test_dir)

from avocado import main
from seleniumlib import *

class NavigateTestSuite(SeleniumTest):
    """
    :avocado: enable
    """
    def testNavigateNoReload(self):
        self.login()
        self.wait_id("host-apps")

        # Bring up a dialog on system page
        self.click(self.wait_link('System', cond=clickable))
        self.wait_frame("system")
        self.click(self.wait_id('system_information_systime_button', cond=clickable))
        self.wait_id('system_information_change_systime', cond=visible)

        # Check hardware info page
        self.click(self.wait_id('system_information_hardware_text', cond=clickable))
        self.mainframe()
        self.wait_frame("hwinfo")
        self.wait_text('BIOS date')
        self.mainframe()

        # Now navigate to the logs
        self.click(self.wait_link('Logs', cond=clickable))
        self.wait_frame("logs")
        self.wait_id("journal-current-day")
        self.mainframe()

        # Now navigate back to system page
        self.click(self.wait_link('System', cond=clickable))
        self.wait_frame("system")
        self.wait_id('system_information_change_systime', cond=visible)

        self.error = False

if __name__ == '__main__':
    main()
