#!/usr/bin/python
# -*- coding: utf-8 -*-

# This file is part of Cockpit.
#
# Copyright (C) 2015 Red Hat, Inc.
#
# Cockpit is free software; you can redistribute it and/or modify it
# under the terms of the GNU Lesser General Public License as published by
# the Free Software Foundation; either version 2.1 of the License, or
# (at your option) any later version.
#
# Cockpit is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
# Lesser General Public License for more details.
#
# You should have received a copy of the GNU Lesser General Public License
# along with Cockpit; If not, see <http://www.gnu.org/licenses/>.

import json
import os

from testlib import *
import testvm

machine_test_dir = "/tmp/avocado_tests"

def prepare_avocado_tests(machine):
    """ Upload all avocado related files and create the results directory
    """
    machine.execute(command="mkdir -p " + MachineCase.avocado_results_dir)
    machine.upload([os.path.join(machine.test_dir, "avocado")], machine_test_dir)

def run_avocado(machine, avocado_tests, print_failed=True, env=[]):
    """ Execute avocado on the machine with the passed environment variables and run
        the specified tests. For example:
        run_avocado(machine,
                    ["checklogin-basic.py", "checklogin-raw.py"],
                    ["HUB=" + self.selenium.address, "BROWSER=firefox"]
                   )
        Return success of the tests (True: all passed, False: at least one failed)
        If 'print_failed' is True, attempt to print a list of failed tests
    """
    cmd_parts = env + ["avocado run",
                 "--job-results-dir " + MachineCase.avocado_results_dir,
                 ' '.join([machine_test_dir +
                           os.sep + x for x in avocado_tests]),
                 ">&2"
                 ]

    try:
        machine.execute(" ".join(cmd_parts))
    except:
        if print_failed:
            # try to get the list of failed tests
            try:
                failed_tests_info = machine.execute(
                        command="cat " + os.path.join(MachineCase.avocado_results_dir, "latest/results.json"),
                        quiet=True
                    )
                failed_tests = json.loads(failed_tests_info)
                for t in failed_tests['tests']:
                    test_status = t['status']
                    if test_status != 'PASS':
                        test_name = t['test']
                        if test_name.startswith(machine_test_dir + '/'):
                            test_name = test_name[(len(machine_test_dir) + 1):]
                        fail_reason = t['fail_reason']
                        print "[" + test_status + "] " + test_name + " (" + fail_reason + ")"
            except:
                print "Unable to show avocado test result summary"
        return False

    return True
