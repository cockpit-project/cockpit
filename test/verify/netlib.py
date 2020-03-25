# This file is part of Cockpit.
#
# Copyright (C) 2017 Red Hat, Inc.
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

import re
import subprocess

from testlib import *


class NetworkHelpers:
    '''Mix-in class for tests that require network setup'''

    def add_veth(self, name):
        '''Add a veth device that is manageable with NetworkManager

        This is safe for @nondestructive tests, the interface gets cleaned up automatically.
        '''
        self.machine.execute(r"""
            mkdir -p /run/udev/rules.d/ &&
            echo 'ENV{ID_NET_DRIVER}=="veth", ENV{INTERFACE}=="%(name)s", ENV{NM_UNMANAGED}="0"' > /run/udev/rules.d/99-nm-veth-%(name)s-test.rules &&
            udevadm control --reload &&
            ip link add name %(name)s type veth
            """ % {"name": name})
        self.addCleanup(self.machine.execute, "rm /run/udev/rules.d/99-nm-veth-{0}-test.rules; ip link del dev {0}".format(name))


class NetworkCase(MachineCase, NetworkHelpers):
    def setUp(self):
        super().setUp()

        m = self.machine

        # Ensure a clean and consistent state.  We remove rogue
        # connections that might still be here from the time of
        # creating the image and we prevent NM from automatically
        # creating new connections.
        # if the command fails, try again
        failures_allowed = 3
        while True:
            try:
                print(m.execute("nmcli con show"))
                m.execute(
                    """nmcli -f UUID,DEVICE connection show | awk '$2 == "--" { print $1 }' | xargs -r nmcli con del""")
                break
            except subprocess.CalledProcessError:
                failures_allowed -= 1
                if failures_allowed == 0:
                    raise

        m.write("/etc/NetworkManager/conf.d/99-test.conf", "[main]\nno-auto-default=*\n")
        m.execute("systemctl reload-or-restart NetworkManager")

        ver = self.machine.execute(
            "busctl --system get-property org.freedesktop.NetworkManager /org/freedesktop/NetworkManager org.freedesktop.NetworkManager Version || true")
        m = re.match('s "(.*)"', ver)
        if m:
            self.networkmanager_version = [int(x) for x in m.group(1).split(".")]
        else:
            self.networkmanager_version = [0]

    def get_iface(self, m, mac):
        def getit():
            path = m.execute("grep -li '%s' /sys/class/net/*/address" % mac)
            return path.split("/")[-2]
        iface = wait(getit).strip()
        print("%s -> %s" % (mac, iface))
        return iface

    def add_iface(self, activate=True):
        m = self.machine
        mac = m.add_netiface(networking=self.network.interface())
        # Wait for the interface to show up
        self.get_iface(m, mac)
        # Trigger udev to make sure that it has been renamed to its final name
        m.execute("udevadm trigger && udevadm settle")
        iface = self.get_iface(m, mac)
        wait(lambda: m.execute('nmcli device | grep %s | grep -v unavailable' % iface))
        if activate:
            m.execute("nmcli con add type ethernet ifname %s con-name %s" % (iface, iface))
            m.execute("nmcli con up %s ifname %s" % (iface, iface))
        return iface

    def wait_for_iface(self, iface, active=True, state=None, prefix="10.111."):
        sel = "#networking-interfaces tr[data-interface='%s']" % iface

        if state:
            text = state
        elif active:
            text = prefix
        else:
            text = "Inactive"

        try:
            self.browser.wait_in_text(sel, text)
        except Error as e:
            print("Interface %s didn't show up." % iface)
            print(self.browser.eval_js("ph_find('#networking-interfaces').outerHTML"))
            print(self.machine.execute("grep . /sys/class/net/*/address"))
            raise e

    def iface_con_id(self, iface):
        con_id = self.machine.execute("nmcli -m tabular -t -f GENERAL.CONNECTION device show %s" % iface).strip()
        if con_id == "" or con_id == "--":
            return None
        else:
            return con_id

    def ensure_nm_uses_dhclient(self):
        m = self.machine
        m.write("/etc/NetworkManager/conf.d/99-dhcp.conf", "[main]\ndhcp=dhclient\n")
        m.execute("systemctl restart NetworkManager")

    def slow_down_dhclient(self, delay):
        m = self.machine
        m.needs_writable_usr()
        m.execute("mv /usr/sbin/dhclient /usr/sbin/dhclient.real")
        m.write("/usr/sbin/dhclient", '#! /bin/sh\nsleep %s\nexec /usr/sbin/dhclient.real "$@"' % delay)
        m.execute("chmod a+x /usr/sbin/dhclient")

    def wait_onoff(self, sel, val):
        self.browser.wait_present(sel + " input" + (":checked" if val else ":not(:checked)"))

    def toggle_onoff(self, sel):
        self.browser.click(sel + " input")
