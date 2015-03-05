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

import os, sys, imp
topdir = "/usr/share/avocado/tests"
libdir = str(os.path.dirname(os.path.abspath(__file__)))+"/lib"
sys.path.append(libdir)
sys.path.append(topdir+"/lib")
from testlib import wait
import cockpit

try:
    a=imp.load_source("", "%s/var.env" % libdir)
    domain=a.IPADOMAIN
    domainip=a.IPADOMAINIP
except:
    a=None
    domain="cockpit.lan"
    domainip="192.168.122.55"
    pass

class checkrealms(cockpit.Test):
    def setup(self):
        cockpit.Test.setup(self)
        self.log.debug("%s/var.env" % libdir)
        process.run("/bin/cp /etc/pam.d/cockpit{,.old}", shell=True, ignore_status=True)
        process.run("/bin/cp /etc/resolv.conf{,.old}", shell=True, ignore_status=True)

        # realmd might warp the time significantly while joining, and
        # that seems to mess with phantomjs timeouts.  So we do the
        # warping upfront.
        #
        process.run("ntpdate %s" % domainip, shell=True)

        process.run("echo -e 'domain %s\nsearch %s\nnameserver %s\n' > /etc/resolv.conf" % (domain, domain, domainip), shell=True, ignore_status=True)
        wait(lambda: process.run("nslookup -type=SRV _ldap._tcp.%s" % domain))
        # create user admin
        process.run("useradd %s -c 'Administrator'" % "admin", shell=True, ignore_status=True)
        process.run("gpasswd wheel -a %s" % "admin", shell=True, ignore_status=True)
        process.run("echo foobar | passwd --stdin %s" % "admin", shell=True)

        process.run("systemctl start cockpit", shell=True ,ignore_status=True)

    def action(self):
        self.testIpa()
        self.check_journal_messages()

    def cleanup(self):
        process.run("systemctl stop cockpit", shell=True)
        process.run("/bin/cp -f /etc/pam.d/cockpit{.old,}", shell=True, ignore_status=True)
        process.run("/bin/cp -f /etc/resolv.conf{.old,}", shell=True, ignore_status=True)
        cockpit.Test.cleanup(self)
        self.log.debug("END")

    def testIpa(self):

        default_user = "admin"
        b = self.browser
        b.login_and_go("server", user=default_user, href="/system/host")


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
                b.set_val("#realms-op-address", domain)
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
        b.set_val("#realms-op-address", domain)
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
        b.set_val("#realms-op-address", domain)
        b.wait_attr("#realms-op-admin", "placeholder", 'e.g. "admin"')
        b.set_val("#realms-op-admin", "admin")
        b.set_val("#realms-op-admin-password", "foobarfoo")
        b.click("#realms-op-apply")
        b.wait_visible("#realms-op-spinner")
        b.click("#realms-op-cancel")
        b.wait_popdown("realms-op")


if __name__ == "__main__":
    job.main()
