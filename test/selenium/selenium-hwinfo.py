#!/usr/bin/python3

from testlib_avocado.seleniumlib import SeleniumTest, clickable, visible
import os
import sys

machine_test_dir = os.path.dirname(os.path.realpath(__file__))
if machine_test_dir not in sys.path:
    sys.path.insert(1, machine_test_dir)


class TestHWinfo(SeleniumTest):
    """
    :avocado: enable
    """

    lscpu = """#!/bin/sh
    echo 'CPU(s):              8'
    echo 'On-line CPU(s) list: 0-7'
    echo 'Thread(s) per core:  2'
    echo 'Core(s) per socket:  4'
    echo 'Socket(s):           1'
    """
    lscpu_file = '/usr/local/bin/lscpu'

    def setUp(self):
        super().setUp()
        self.login()
        cmd = "cat | sudo tee '%s'" % self.lscpu_file
        self.machine.execute(command=cmd, input=self.lscpu)
        self.machine.execute('sudo chmod a+x {}'.format(self.lscpu_file))
        self.click(self.wait_link('System', cond=clickable))
        self.wait_frame("localhost/system")

        self.click(self.wait_id("system_information_hardware_text"))
        self.mainframe()
        self.wait_frame("localhost/system/hwinfo")
        self.wait_id("hwinfo", jscheck=True)

    def tearDown(self):
        self.machine.execute('sudo rm -f {}'.format(self.lscpu_file))
        super().tearDown()

    def testCPUinfo(self):
        self.wait_text("BIOS", cond=visible)
        cpuinfo = self.machine.execute("cat /proc/cpuinfo | grep  'model name' |cut -d ':' -f 2").strip()
        self.wait_text(cpuinfo, cond=visible)

    def testSMT(self):

        self.click(self.wait_link("Mitigations"))
        self.wait_id("cpu-mitigations-dialog", jscheck=True)
        self.click(self.wait_id("nosmt-switch"))
        self.wait_text("Save and reboot", cond=clickable)
        self.click(self.wait_text("Cancel", cond=clickable))
        self.click(self.wait_link("Mitigations", cond=clickable))
        self.mainframe()
