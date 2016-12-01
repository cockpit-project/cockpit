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

from avocado import main
from avocado import Test
import sys
import os
sys.path.append(os.path.abspath(os.path.dirname(__file__)))
import cockpit

username = "user"

admins_only_pam = """account    sufficient   pam_succeed_if.so uid = 0\\
account    required     pam_succeed_if.so user ingroup wheel"""


class checklogin_basic(Test):
    """
    Test login for cockpit
    """

    def testLogin(self):
        c = cockpit.Cockpit()
        b = c.browser

        # Setup users and passwords
        setup_cmd = "useradd %s -c 'Barney Bär'; echo %s:abcdefg | chpasswd" % (
            username, username)
        cleanup_cmd = "userdel -r %s" % username
        c.run_shell_command(setup_cmd, cleanup_cmd)

        def deny_non_root(remote_filename):
            c.run_shell_command(
                """sed -i '/nologin/a %s' %s || true""" % (admins_only_pam, remote_filename))

        deny_non_root("/etc/pam.d/cockpit")
        deny_non_root("/etc/pam.d/sshd")

        b.open("/system")
        b.wait_visible("#login")

        def login(user, password):
            b.wait_not_present("#login-button:disabled")
            b.set_val('#login-user-input', user)
            b.set_val('#login-password-input', password)
            b.set_checked('#authorized-input', True)
            b.click('#login-button')

        # Try to login as a non-existing user
        login("nonexisting", "blahblah")
        b.wait_text_not("#login-error-message", "")

        # Try to login as user with a wrong password
        login(username, "gfedcba")
        b.wait_text_not("#login-error-message", "")

        # Try to login as user with correct password
        login(username, "abcdefg")
        b.wait_text("#login-error-message", "Permission denied")

        # Login as admin
        b.open("/system")
        login("admin", "foobar")
        with b.wait_timeout(10) as r:
            b.expect_load()
        b.wait_present("#content")
        b.wait_text('#content-user-name', 'Administrator')

        # reload, which should log us in with the cookie
        b.reload()
        b.wait_present("#content")
        b.wait_text('#content-user-name', 'Administrator')

        b.click("#content-user-name")
        b.wait_visible('#go-account')
        b.click('#go-account')
        b.enter_page("/users")
        b.wait_text("#account-user-name", "admin")

        c.allow_journal_messages("Returning error-response ... with reason .*",
                                 "pam_unix\(cockpit:auth\): authentication failure; .*",
                                 "pam_unix\(cockpit:auth\): check pass; user unknown",
                                 "pam_succeed_if\(cockpit:auth\): requirement .* not met by user .*")

        c.tearDown()


if __name__ == "__main__":
    main()
