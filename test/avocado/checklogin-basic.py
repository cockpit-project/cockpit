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
import cockpit

username="user"

admins_only_pam = """
#%PAM-1.0
auth	   required	pam_sepermit.so
auth       substack     password-auth
auth       include      postlogin
auth       optional     pam_reauthorize.so prepare
account    required     pam_nologin.so
account    sufficient   pam_succeed_if.so uid = 0
account    required     pam_succeed_if.so user ingroup wheel
account    include      password-auth
password   include      password-auth
# pam_selinux.so close should be the first session rule
session    required     pam_selinux.so close
session    required     pam_loginuid.so
# pam_selinux.so open should only be followed by sessions to be executed in the user context
session    required     pam_selinux.so open env_params
session    optional     pam_keyinit.so force revoke
session    optional     pam_reauthorize.so prepare
session    include      password-auth
session    include      postlogin
"""

class checklogin_basic(cockpit.Test):
    """
    Test login for cockpit
    """

    def phase(self):
        b = self.browser

        # Setup users and passwords
        setup_cmd = "useradd %s -c 'Barney Bär'; echo abcdefg | passwd --stdin %s" % (username, username)
        cleanup_cmd = "userdel -r %s" % username
        self.run_shell_command(setup_cmd, cleanup_cmd)

        # Setup a special PAM config that disallows non-wheel users
        self.replace_file("/etc/pam.d/cockpit", admins_only_pam)

        b.open("/system")
        b.wait_visible("#login")

        def login(user, password):
            b.set_val('#login-user-input', user)
            b.set_val('#login-password-input', password)
            b.click('#login-button')

        # Try to login as a non-existing user
        login("nonexisting", "blahblah")
        b.wait_text_not("#login-error-message", "")

        # Try to login as user with a wrong password
        login(username, "gfedcba")
        b.wait_text_not("#login-error-message", "")

        # Try to login as user with correct password
        login (username, "abcdefg")
        b.wait_text("#login-error-message", "Permission denied")

        # Login as admin
        login("admin", "foobar")
        b.expect_load()
        b.wait_present("#content")
        b.wait_text('#content-user-name', 'Administrator')

        # reload, which should log us in with the cookie
        b.reload()
        b.wait_present("#content")
        b.wait_text('#content-user-name', 'Administrator')

        b.click('#go-account')
        b.enter_page("account")
        b.wait_text ("#account-user-name", "admin")

        self.allow_journal_messages ("Returning error-response ... with reason .*",
                                     "pam_unix\(cockpit:auth\): authentication failure; .*",
                                     "pam_unix\(cockpit:auth\): check pass; user unknown",
                                     "pam_succeed_if\(cockpit:auth\): requirement .* not met by user .*")

if __name__ == "__main__":
    main()
