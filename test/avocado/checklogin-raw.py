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

import base64
import time
import subprocess

from avocado import main
from avocado import Test
import sys
import os
sys.path.append(os.path.abspath(os.path.dirname(__file__)))
import cockpit


machine = "localhost"


class checklogin_raw(Test):
    """
    Test login for cockpit
    """

    def curl_auth(self, url, userpass):
        header = "Authorization: Basic " + base64.b64encode(userpass)
        return subprocess.check_output(['/usr/bin/curl', '-s', '-k',  '-D', '-',
                                        '--header', header,
                                        'http://%s:9090%s' % (machine, url)])

    def curl_auth_code(self, url, userpass):
        lines = self.curl_auth(url, userpass).splitlines()
        assert len(lines) > 0
        tokens = lines[0].split(' ', 2)
        assert len(tokens) == 3
        return int(tokens[1])

    def testRaw(self):
        c = cockpit.Cockpit()
        time.sleep(0.5)
        self.assertEqual(self.curl_auth_code('/cockpit/login', ''), 401)
        self.assertEqual(self.curl_auth_code('/cockpit/login', 'foo:'), 401)
        self.assertEqual(self.curl_auth_code(
            '/cockpit/login', 'foo:bar\n'), 401)
        self.assertEqual(self.curl_auth_code(
            '/cockpit/login', 'foo:bar:baz'), 401)
        self.assertEqual(self.curl_auth_code('/cockpit/login', ':\n\n'), 401)
        self.assertEqual(self.curl_auth_code(
            '/cockpit/login', 'admin:bar'), 401)
        self.assertEqual(self.curl_auth_code('/cockpit/login', 'foo:bar'), 401)
        self.assertEqual(self.curl_auth_code(
            '/cockpit/login', 'admin:' + 'x' * 4000), 401)
        self.assertEqual(self.curl_auth_code(
            '/cockpit/login', 'x' * 4000 + ':bar'), 401)
        self.assertEqual(self.curl_auth_code(
            '/cockpit/login', 'a' * 4000 + ':'), 401)
        self.assertEqual(self.curl_auth_code(
            '/cockpit/login', 'a' * 4000 + ':b\nc'), 401)
        self.assertEqual(self.curl_auth_code(
            '/cockpit/login', 'a' * 4000 + ':b\nc\n'), 401)

        c.allow_journal_messages("Returning error-response ... with reason .*",
                                    "pam_unix\(cockpit:auth\): authentication failure; .*",
                                    "pam_unix\(cockpit:auth\): check pass; user unknown",
                                    "pam_succeed_if\(cockpit:auth\): requirement .* not met by user .*",
                                    "couldn't parse login input: Malformed input",
                                    "couldn't parse login input: Authentication failed")
if __name__ == "__main__":
    main()
