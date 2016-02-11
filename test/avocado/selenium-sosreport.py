#!/usr/bin/python

# we need to be able to find and import seleniumlib, so add this directory
import os
import sys
machine_test_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(1, machine_test_dir)

from avocado import main
from avocado.utils import process
import libdisc
from seleniumlib import *

class BasicTestSuite(SeleniumTest):
    """
    :avocado: enable
    """
    def test10SosReport(self):
        self.login()
        self.wait_id("sidebar")
        self.wait_id("tools-panel",cond=invisible)
        self.click(self.wait_link('Tools', cond=clickable))
        self.wait_id("tools-panel")
        self.click(self.wait_link('Diagnostic report', cond=clickable))
        self.wait_frame("sosreport")
        self.wait_text("This tool will collect system configuration and diagnostic")
        self.click(self.wait_xpath('//button[@data-target="#sos"]', cond=clickable))
        self.wait_id("sos")
        self.wait_text("Generating report")
        process.run("pgrep sosreport", shell=True)
        process.run("echo Waiting for sosreport;while true;do if pgrep sosreport >/dev/null;then echo -n .;else echo Finished;break;fi;sleep 1;done", shell=True)
        self.wait_text("Download report")
        self.click(self.wait_id("sos-cancel", cond=clickable))
        self.wait_text("This tool will collect system configuration and diagnostic")
        self.mainframe()
        self.error = False
