# -*- coding: utf-8 -*-

# This file is part of Cockpit.
#
# Copyright (C) 2013 Red Hat, Inc.
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

import sys
import time
import unittest

class TapResult(unittest.TestResult):
    def __init__(self, verbosity):
        self.offset = 0
        self.start_time = 0
        super(TapResult, self).__init__(sys.stderr, False, verbosity)

    @staticmethod
    def plan(testable):
        count = testable.countTestCases()
        sys.stdout.write("1..{0}\n".format(count))
        sys.stdout.flush()

    def ok(self, test):
        data = "ok {0} {1} duration: {2}s\n".format(self.offset,
                str(test), int(time.time() - self.start_time))
        sys.stdout.write(data)
        sys.stdout.flush()

    def not_ok(self, test, err):
        data = "not ok {0} {1} duration: {2}s\n".format(self.offset,
                str(test), int(time.time() - self.start_time))
        if err:
            data = self._exc_info_to_string(err, test) + "\n" + data
        sys.stdout.write(data)
        sys.stdout.flush()

    def skip(self, test, reason):
        sys.stdout.write("ok {0} {1} duration: {2}s # SKIP {3}\n".format(self.offset,
            str(test), int(time.time() - self.start_time), reason))
        sys.stdout.flush()

    def stop(self):
        sys.stdout.write("Bail out!\n")
        sys.stdout.flush()
        super(TapResult, self).stop()

    def startTest(self, test):
        self.start_time = time.time()
        self.offset += 1
        super(TapResult, self).startTest(test)

    def stopTest(self, test):
        super(TapResult, self).stopTest(test)

    def addError(self, test, err):
        self.not_ok(test, err)
        super(TapResult, self).addError(test, err)

    def addFailure(self, test, err):
        self.not_ok(test, err)
        super(TapResult, self).addError(test, err)

    def addSuccess(self, test):
        self.ok(test)
        super(TapResult, self).addSuccess(test)

    def addSkip(self, test, reason):
        self.skip(test, reason)
        super(TapResult, self).addSkip(test, reason)

    def addExpectedFailure(self, test, err):
        self.ok(test)
        super(TapResult, self).addExpectedFailure(test, err)

    def addUnexpectedSuccess(self, test):
        self.not_ok(test, None)
        super(TapResult, self).addUnexpectedSuccess(test)

class TapRunner(object):
    resultclass = TapResult

    def __init__(self, stream=None, descriptions=False, verbosity=1,
                 failfast=False, resultclass=None):
        self.verbosity = verbosity
        self.failfast = failfast
        if resultclass is not None:
            self.resultclass = resultclass

    def run(self, testable):
        TapResult.plan(testable)
        result = self.resultclass(self.verbosity)
        result.failfast = self.failfast
        startTestRun = getattr(result, 'startTestRun', None)
        if startTestRun is not None:
            startTestRun()
        try:
            testable(result)
        finally:
            stopTestRun = getattr(result, 'stopTestRun', None)
            if stopTestRun is not None:
                stopTestRun()
        return result
