# -*- coding: utf-8 -*-

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

from testlib import *

class NetworkCase(MachineCase):
    def setUp(self):
        MachineCase.setUp(self)

        m = self.machine

        # Ensure a clean and consistent state.  We remove rogue
        # connections that might still be here from the time of
        # creating the image and we prevent NM from automatically
        # creating new connections.

        m.execute("""nmcli -f UUID,DEVICE connection show | awk '$2 == "--" { print $1 }' | xargs -r nmcli con del""")
        m.write("/etc/NetworkManager/conf.d/99-test.conf", "[main]\nno-auto-default=*\n")
        m.execute("systemctl reload-or-restart NetworkManager")

    def get_iface(self, m, mac):
        def getit():
            path = m.execute("grep -li '%s' /sys/class/net/*/address" % mac)
            return path.split("/")[-2]
        iface = wait(getit).strip()
        print "%s -> %s" % (mac, iface)
        return iface

    def add_iface(self, mac=None, vlan=0, activate=True):
        m = self.machine
        mac = m.add_netiface(mac=mac, vlan=vlan)
        # Wait for the interface to show up
        self.get_iface(m, mac)
        # Trigger udev to make sure that it has been renamed to its final name
        m.execute("udevadm trigger && udevadm settle")
        iface = self.get_iface(m, mac)
        wait(lambda: m.execute('nmcli device | grep %s | grep -v unavailable' % iface))
        if activate:
            m.execute("nmcli con add type ethernet ifname %s" % iface)
            m.execute("nmcli dev con %s" % iface)
        return iface

    def wait_for_iface(self, iface, active=True, state=None):
        sel = "#networking-interfaces tr[data-interface='%s']" % iface

        if state:
            text = state
        elif active:
            text = "10.111."
        else:
            text = "Inactive"

        try:
            self.browser.wait_present(sel)
            self.browser.wait_visible(sel)
            self.browser.wait_in_text(sel, text)
        except:
            print "Interface %s didn't show up." % iface
            print self.browser.eval_js("$('#networking-interfaces').html()")
            print self.machine.execute("grep . /sys/class/net/*/address")
            raise

    def iface_con_id(self, iface):
        con_id = self.machine.execute("nmcli -m tabular -t -f GENERAL.CONNECTION device show %s" % iface).strip()
        if con_id == "--":
            return None
        else:
            return con_id

    def slow_down_dhcp(self, delay):
        m = self.machine
        m.needs_writable_usr()
        m.execute("mv /usr/sbin/dhclient /usr/sbin/dhclient.real")
        m.write("/usr/sbin/dhclient", '#! /bin/sh\nsleep %s\nexec /usr/sbin/dhclient.real "$@"' % delay)
        m.execute("chmod a+x /usr/sbin/dhclient")
