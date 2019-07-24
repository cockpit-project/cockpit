#!/usr/bin/python3

# we need to be able to find and import seleniumlib, so add this directory
from testlib_avocado.timeoutlib import Retry
from testlib_avocado.seleniumlib import SeleniumTest, clickable
import os
import sys
import subprocess

machine_test_dir = os.path.dirname(os.path.abspath(__file__))
if machine_test_dir not in sys.path:
    sys.path.insert(1, machine_test_dir)


class SosReportingTab(SeleniumTest):
    """
    :avocado: enable
    """

    def test10SosReport(self):
        self.login()
        self.click(self.wait_link('Diagnostic Report', cond=clickable))
        self.wait_frame("sosreport")
        self.wait_text("This tool will collect system configuration and diagnostic")
        self.click(self.wait_xpath('//button[@data-target="#sos"]', cond=clickable))
        self.wait_id("sos")
        self.wait_text("Generating report")

        @Retry(attempts=10, timeout=3, exceptions=(subprocess.CalledProcessError,),
               error=Exception('Timeout: sosreport did not start'))
        def waitforsosreportstarted():
            self.machine.execute("pgrep sosreport")
        waitforsosreportstarted()
        # duration of report generation depends on the target system - as along as sosreport is active, we don't want to timeout
        # it is also important to call some selenium method there to ensure that connection to HUB will not be lost

        @Retry(attempts=150, timeout=10, exceptions=(subprocess.CalledProcessError,),
               error=Exception('Timeout: sosreport did not finish'), inverse=True)
        def waitforsosreport():
            self.machine.execute("pgrep sosreport")
            self.wait_text("Generating report", overridetry=5)
        waitforsosreport()
        element = self.wait_id("sos-download")
        self.wait_xpath('//button[contains(text(), "%s")]' % "Download", cond=clickable, baseelement=element)
        self.click(self.wait_id("sos-cancel", cond=clickable))
        self.wait_text("This tool will collect system configuration and diagnostic")
        self.mainframe()
