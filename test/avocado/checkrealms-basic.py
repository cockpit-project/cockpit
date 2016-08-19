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

from avocado import job
from avocado.utils import process

from testlib import wait
import cockpit

class checkrealms_basic(cockpit.Test):
    def test(self):
        domain = self.environment.IPADOMAIN
        domainip = self.environment.IPADOMAINIP

        self.replace_file("/etc/resolv.conf",
                          "domain %s\nsearch %s\nnameserver %s\n"
                          % (domain, domain, domainip))

        # Wait for DNS to work as expected.
        # https://bugzilla.redhat.com/show_bug.cgi?id=1071356#c11
        #
        wait(lambda: process.run("nslookup -type=SRV _ldap._tcp.%s" % domain))

        default_user = "admin"
        b = self.browser

        b.login_and_go("/system", user=default_user)

        def wait_number_domains(n):
            if n == 0:
                b.wait_text("#system-info-domain a", "Join Domain")
            else:
                b.wait_text_not("#system-info-domain a", "Join Domain")
            b.wait_not_attr("#system-info-domain a", "disabled", "disabled")

        wait_number_domains(0)

        # Join cockpit.lan
        b.click("#system-info-domain a")
        b.wait_popup("realms-op")
        with b.wait_timeout(120):
            b.set_val(".realms-op-address", domain)
            b.wait_attr(".realms-op-admin", "placeholder", 'e.g. "admin"')
            b.set_val(".realms-op-admin", "admin")
            b.set_val(".realms-op-admin-password", "foobarfoo")
            b.click(".realms-op-apply")
            b.wait_popdown("realms-op")

            # Check that this has worked
            wait_number_domains(1)

        # Leave the domain
        b.click("#system-info-domain a")
        b.wait_popup("realms-op")
        b.click(".realms-op-apply")
        b.wait_popdown("realms-op")
        wait_number_domains(0)

        # Send a wrong password
        b.click("#system-info-domain a")
        b.wait_popup("realms-op")
        b.set_val(".realms-op-address", domain)
        b.wait_attr(".realms-op-admin", "placeholder", 'e.g. "admin"')
        b.set_val(".realms-op-admin", "admin")
        b.set_val(".realms-op-admin-password", "foo")
        b.click(".realms-op-apply")
        b.wait_text_not(".realms-op-error", "")
        b.click(".realms-op-cancel")
        b.wait_popdown("realms-op")

        # Try to join a non-existing domain
        b.click("#system-info-domain a")
        b.wait_popup("realms-op")
        b.set_val(".realms-op-address", "NOPE")
        b.wait_js_cond("$('.realms-op-address-error').attr('title') != ''")
        b.click(".realms-op-cancel")
        b.wait_popdown("realms-op")

        # Cancel a join
        b.click("#system-info-domain a")
        b.wait_popup("realms-op")
        b.set_val(".realms-op-address", domain)
        b.wait_attr(".realms-op-admin", "placeholder", 'e.g. "admin"')
        b.set_val(".realms-op-admin", "admin")
        b.set_val(".realms-op-admin-password", "foobarfoo")
        b.click(".realms-op-apply")
        b.wait_visible(".realms-op-spinner")
        b.click(".realms-op-cancel")
        b.wait_popdown("realms-op")

if __name__ == "__main__":
    job.main()
