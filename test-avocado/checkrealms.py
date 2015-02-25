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

from avocado import job
from avocado import test
from avocado.utils import process

import os, sys
topdir = "/usr/share/avocado/tests"
sys.path.append(str(os.path.dirname(os.path.abspath(__file__)))+"/lib")
sys.path.append(topdir+"/lib")
from testlib import *
from libjournal import *

ipaaddress=""

class checkrealms(test.Test):
    def setup(self):
#       process.run("echo -e 'domain cockpit.lan\nsearch cockpit.lan\nnameserver %s\n' > /etc/resolv.conf" % ipaaddress, shell=True, ignore_status=True)
        wait(lambda: process.run("nslookup -type=SRV _ldap._tcp.cockpit.lan"))
        # create user admin
        process.run("useradd %s -c 'Administrator'" % "admin", shell=True, ignore_status=True)
        process.run("gpasswd wheel -a %s" % "admin", shell=True, ignore_status=True)
        process.run("echo foobar | passwd --stdin %s" % "admin", shell=True)
        process.run("echo '%s' > /etc/pam.d/cockpit" % admins_only_pam, shell=True)

        process.run("systemctl start cockpit", shell=True ,ignore_status=True)
        
    def action(self):
        testIpa
        
    def cleanup(self):
        process.run("systemctl stop cockpit", shell=True)
        process.run("/bin/cp -f /etc/pam.d/cockpit{.old,}", shell=True, ignore_status=True)
        self.log.debug("END")
    
    def testIpa(self):

        default_user = "admin"
        b=Browser("localhost", "x")
        b.login_and_go("localhost",user=default_user,password="foobar")
        
        
        def wait_number_domains(n):
            if n == 0:
                b.wait_text("#system_information_realms_button", "Join Domain")
            else:
                b.wait_text_not("#system_information_realms_button", "Join Domain")
            b.wait_dbus_prop('com.redhat.Cockpit.Realms', 'Busy', ",")

        wait_number_domains(0)

        # Join cockpit.lan
        b.click("#system_information_realms_button")
        b.wait_popup("realms-op")
	with b.wait_timeout(120):
                b.set_val("#realms-op-address", "cockpit.lan")
	        b.wait_attr("#realms-op-admin", "placeholder", 'e.g. "admin"')
	        b.set_val("#realms-op-admin", "admin")
	        b.set_val("#realms-op-admin-password", "foobarfoo")
	        b.click("#realms-op-apply")
	        b.wait_popdown("realms-op")

	        # Check that this has worked
	        wait_number_domains(1)

        # Leave the domain
        b.click("#system_information_realms_button")
        b.wait_popup("realms-op")
        b.click("#realms-op-apply")
        b.wait_popdown("realms-op")
        wait_number_domains(0)

        # Send a wrong password
        b.click("#system_information_realms_button")
        b.wait_popup("realms-op")
        b.set_val("#realms-op-address", "cockpit.lan")
        b.wait_attr("#realms-op-admin", "placeholder", 'e.g. "admin"')
        b.set_val("#realms-op-admin", "admin")
        b.set_val("#realms-op-admin-password", "foo")
        b.click("#realms-op-apply")
        b.wait_text_not("#realms-op-error", "")
        b.click("#realms-op-cancel")
        b.wait_popdown("realms-op")

        # Try to join a non-existing domain
        b.click("#system_information_realms_button")
        b.wait_popup("realms-op")
        b.set_val("#realms-op-address", "NOPE")
        b.wait_js_cond("$('#realms-op-address-error').attr('title') != ''")
        b.click("#realms-op-cancel")
        b.wait_popdown("realms-op")

        # Cancel a join
        b.click("#system_information_realms_button")
        b.wait_popup("realms-op")
        b.set_val("#realms-op-address", "cockpit.lan")
        b.wait_attr("#realms-op-admin", "placeholder", 'e.g. "admin"')
        b.set_val("#realms-op-admin", "admin")
        b.set_val("#realms-op-admin-password", "foobarfoo")
        b.click("#realms-op-apply")
        b.wait_visible("#realms-op-spinner")
        b.click("#realms-op-cancel")
        b.wait_popdown("realms-op")

