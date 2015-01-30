#!/usr/bin/python
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

#import sys
#sys.path.append("/usr/share/eclipse/dropins/pydev/plugins/org.python.pydev_3.7.1.201409180657/pysrc/")
#import pydevd
#pydevd.settrace("127.0.0.1")

import base64
import time

from avocado import job
from avocado.utils import process

import os, sys
topdir = "/usr/share/avocado/tests"
sys.path.append(str(os.path.dirname(os.path.abspath(__file__)))+"/lib")
sys.path.append(topdir+"/lib")
from testlib import *

admins_only_pam = """
#%PAM-1.0
auth       required     pam_sepermit.so
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
username="user"

class checklogin(test.Test):
    """
    Test login for cockpit
    """
    
    def Basic(self):
        b=Browser("localhost", "x")
        b.open("localhost")
        b.wait_visible("#login")
        
        def login(user, password):
            b.set_val('#login-user-input', user)
            b.set_val('#login-password-input', password)
            b.click('#login-button')

        # Try to login as a non-existing user
        login("nonexisting", "blahblah")
        self.assertTrue(b.wait_text_not("#login-error-message", ""))

        # Try to login as user with a wrong password
        login("user", "gfedcba")
        self.assertTrue(b.wait_text_not("#login-error-message", ""))

        # Try to login as user with correct password
        login ("user", "abcdefg")
        self.assertTrue(b.wait_text("#login-error-message", "Permission denied"))

        # Login as admin
        login("admin", "foobar")
        b.expect_reload()
        self.assertTrue(b.wait_text('#content-user-name', 'Administrator'))

        # reload, which should log us in with the cookie
        b.reload()
        self.assertTrue(b.wait_text('#content-user-name', 'Administrator'))
        b.click('a[onclick*="shell.go_login_account"]')
        b.wait_page("account")
        self.assertTrue(b.wait_text ("#account-user-name", "admin"))
        
        j=Journalctl()
        j.allow_journal_messages ("Returning error-response ... with reason .*", "pam_unix\(cockpit:auth\): authentication failure; .*", "pam_unix\(cockpit:auth\): check pass; user unknown", "pam_succeed_if\(cockpit:auth\): requirement .* not met by user .*")

        j.allow_restart_journal_messages
        j.check_journal_messages()

    def curl_auth(self, url, userpass):
        header = "Authorization: Basic " + base64.b64encode(userpass)
        return process.run("/usr/bin/curl -s -k -D - --header %s http://%s:9090%s " %  (header, "localhost", url), ignore_status=True)

    def curl_auth_code(self, url, userpass):
        lines = self.curl_auth(url, userpass).stdout.splitlines()
        assert len(lines) > 0
        tokens = lines[0].split(' ', 2)
        assert len(tokens) == 3
        self.log.debug(tokens)
        return int(tokens[1])

    def Raw(self):
        time.sleep(0.5)
        self.assertEqual(self.curl_auth_code ('/login', ''), 401)
        self.assertEqual(self.curl_auth_code ('/login', 'foo:'), 401)
        self.assertEqual(self.curl_auth_code ('/login', 'foo:bar\n'), 401)
        self.assertEqual(self.curl_auth_code ('/login', 'foo:bar:baz'), 401)
        self.assertEqual(self.curl_auth_code ('/login', ':\n\n'), 401)
        self.assertEqual(self.curl_auth_code ('/login', 'admin:bar'), 401)
        self.assertEqual(self.curl_auth_code ('/login', 'foo:bar'), 401)
        self.assertEqual(self.curl_auth_code ('/login', 'admin:' + 'x' * 4000), 401)
        self.assertEqual(self.curl_auth_code ('/login', 'x' * 4000 + ':bar'), 401)
        self.assertEqual(self.curl_auth_code ('/login', 'a' * 4000 + ':'), 401)
        self.assertEqual(self.curl_auth_code ('/login', 'a' * 4000 + ':b\nc'), 401)
        self.assertEqual(self.curl_auth_code ('/login', 'a' * 4000 + ':b\nc\n'), 401)
        j=Journalctl()
        j.allow_journal_messages ("Returning error-response ... with reason .*", "pam_unix\(cockpit:auth\): authentication failure; .*", "pam_unix\(cockpit:auth\): check pass; user unknown", "pam_succeed_if\(cockpit:auth\): requirement .* not met by user .*", "couldn't parse login input: Malformed input", "couldn't parse login input: Authentication failed")
        j.allow_restart_journal_messages
        j.check_journal_messages()        
        
    def setup(self):
# Setup users and passwords
        process.run("useradd %s -c 'Barney Bär'" % username, shell=True, ignore_status=True)
        process.run("echo abcdefg | passwd --stdin %s" % username, shell=True)

        process.run("useradd %s -c 'Administrator'" % "admin", shell=True, ignore_status=True)
        process.run("gpasswd wheel -a %s" % "admin", shell=True, ignore_status=True)
        process.run("/bin/cp /etc/pam.d/cockpit{,.old}", shell=True, ignore_status=True)
        process.run("echo foobar | passwd --stdin %s" % "admin", shell=True)


        # Setup a special PAM config that disallows non-wheel users
        process.run("echo '%s' > /etc/pam.d/cockpit" % admins_only_pam, shell=True)

        process.run("systemctl start cockpit", shell=True ,ignore_status=True)


    def action(self):
        self.log.info("Start Testing")
        self.Basic()
        self.Raw()

    def cleanup(self):
        process.run("userdel -r %s" % username, shell=True, ignore_status=True)
        process.run("systemctl stop cockpit", shell=True)
        process.run("/bin/cp -f /etc/pam.d/cockpit{.old,}", shell=True, ignore_status=True)
        self.log.debug("END")

if __name__ == "__main__":
    job.main()