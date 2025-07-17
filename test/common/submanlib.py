# This file is part of Cockpit.
#
# Copyright (C) 2025 Red Hat, Inc.
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
# along with Cockpit; If not, see <https://www.gnu.org/licenses/>.

import os

import testlib
from machine import testvm


class SubscriptionCase(testlib.MachineCase):

    def setup_candlepin_service(self, candlepin_machine: testvm.Machine) -> None:
        m = self.machine

        # wait for candlepin to be active and verify
        candlepin_machine.execute("/root/run-candlepin")

        # remove all existing products (RHEL server), as we can't control them
        m.execute("rm -f /etc/pki/product-default/*.pem /etc/pki/product/*.pem")

        # download product info from the candlepin machine and install it
        product_file = os.path.join(self.tmpdir, "88888.pem")
        candlepin_machine.download("/home/admin/candlepin/generated_certs/88888.pem", product_file)

        # upload product info to the test machine
        m.execute("mkdir -p /etc/pki/product-default")
        m.upload([product_file], "/etc/pki/product-default")

        # set up CA
        ca = candlepin_machine.execute("cat /home/admin/candlepin/certs/candlepin-ca.crt")
        m.write("/etc/pki/ca-trust/source/anchors/candlepin-ca.crt", ca)
        m.write("/etc/hosts", "10.111.112.100 services.cockpit.lan\n", append=True)
        m.execute("cp /etc/pki/ca-trust/source/anchors/candlepin-ca.crt /etc/rhsm/ca/candlepin-ca.pem")
        m.execute("update-ca-trust")

        # Wait for the web service to be accessible
        m.execute("until curl --fail --silent --show-error https://services.cockpit.lan:8443/candlepin/status; do sleep 1; done")

        # setup the repositories properly using the candlepin RPM GPG key
        m.execute("curl -o /etc/pki/rpm-gpg/RPM-GPG-KEY-candlepin http://services.cockpit.lan:8080/RPM-GPG-KEY-candlepin")
        m.execute("subscription-manager config --rhsm.baseurl http://services.cockpit.lan:8080")

        # perform the additional configuration of subscription-manager
        m.execute(
            "subscription-manager config --server.hostname services.cockpit.lan --server.port 8443 --server.prefix /candlepin")

    def register_with_candlepin(self) -> None:
        self.machine.execute(
            "LC_ALL=C.UTF-8 subscription-manager register --org=donaldduck --activationkey=awesome_os_pool")
