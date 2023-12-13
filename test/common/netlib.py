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

from testlib import Error, MachineCase, wait


class NetworkHelpers:
    """Mix-in class for tests that require network setup"""

    def add_veth(self, name, dhcp_cidr=None, dhcp_range=None):
        """Add a veth device that is manageable with NetworkManager

        This is safe for @nondestructive tests, the interface gets cleaned up automatically.
        """
        if dhcp_range is None:
            dhcp_range = ['10.111.112.2', '10.111.127.254']
        self.machine.execute(r"""
            mkdir -p /run/udev/rules.d/
            echo 'ENV{ID_NET_DRIVER}=="veth", ENV{INTERFACE}=="%(name)s", ENV{NM_UNMANAGED}="0"' > /run/udev/rules.d/99-nm-veth-%(name)s-test.rules
            udevadm control --reload
            ip link add name %(name)s type veth peer name v_%(name)s
            # Trigger udev to make sure that it has been renamed to its final name
            udevadm trigger --subsystem-match=net
            udevadm settle
            """ % {"name": name})
        self.addCleanup(self.machine.execute, f"rm /run/udev/rules.d/99-nm-veth-{name}-test.rules; ip link del dev {name}")
        if dhcp_cidr:
            # up the remote end, give it an IP, and start DHCP server
            self.machine.execute(f"ip a add {dhcp_cidr} dev v_{name}; ip link set v_{name} up")
            server = self.machine.spawn("dnsmasq --keep-in-foreground --log-queries --log-facility=- "
                                        f"--conf-file=/dev/null --dhcp-leasefile=/tmp/leases.{name} --no-resolv "
                                        f"--bind-interfaces --except-interface=lo --interface=v_{name} --dhcp-range={dhcp_range[0]},{dhcp_range[1]},4h",
                                        f"dhcp-{name}.log")
            self.addCleanup(self.machine.execute, "kill %i" % server)
            self.machine.execute("if firewall-cmd --state >/dev/null 2>&1; then firewall-cmd --add-service=dhcp; fi")

    def nm_activate_eth(self, iface):
        """Create an NM connection for a given interface"""

        m = self.machine
        wait(lambda: m.execute(f'nmcli device | grep "{iface}.*disconnected"'))
        m.execute(f"nmcli con add type ethernet ifname {iface} con-name {iface}")
        m.execute(f"nmcli con up {iface} ifname {iface}")
        self.addCleanup(m.execute, f"nmcli con delete {iface}")

    def nm_checkpoints_disable(self):
        self.browser.eval_js("window.cockpit_tests_disable_checkpoints = true;")

    def nm_checkpoints_enable(self, settle_time=3.0):
        self.browser.eval_js("window.cockpit_tests_disable_checkpoints = false;")
        self.browser.eval_js(f"window.cockpit_tests_checkpoint_settle_time = {settle_time};")


class NetworkCase(MachineCase, NetworkHelpers):
    def setUp(self):
        super().setUp()

        m = self.machine

        # clean up after nondestructive tests
        if self.is_nondestructive():
            def devs():
                return set(self.machine.execute("ls /sys/class/net/ | grep -v bonding_masters").strip().split())

            def cleanupDevs():
                new = devs() - self.orig_devs
                self.machine.execute(f"for d in {' '.join(new)}; do nmcli dev del $d; done")

            self.orig_devs = devs()
            self.restore_dir("/etc/NetworkManager", restart_unit="NetworkManager")
            self.restore_dir("/etc/sysconfig/network-scripts")
            self.restore_dir("/etc/netplan")
            self.restore_dir("/run/NetworkManager/system-connections")
            self.addCleanup(cleanupDevs)

        m.execute("systemctl start NetworkManager")

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

        # our assertions and pixel tests assume that virbr0 is absent
        m.execute('[ -z "$(systemctl --legend=false list-unit-files libvirtd.service)" ] || '
                  'systemctl try-restart libvirtd.service')
        if 'default' in m.execute("virsh net-list --name || true"):
            m.execute("virsh net-autostart --disable default; virsh net-destroy default")

        ver = self.machine.execute(
            "busctl --system get-property org.freedesktop.NetworkManager /org/freedesktop/NetworkManager org.freedesktop.NetworkManager Version || true")
        ver_match = re.match('s "(.*)"', ver)
        if ver_match:
            self.networkmanager_version = [int(x) for x in ver_match.group(1).split(".")]
        else:
            self.networkmanager_version = [0]

        # Something unknown sometimes goes wrong with PCP, see #15625
        self.allow_journal_messages("pcp-archive: no such metric: network.interface.* Unknown metric name",
                                    "direct: instance name lookup failed: network.*")

    def get_iface(self, m, mac):
        def getit():
            path = m.execute(f"grep -li '{mac}' /sys/class/net/*/address")
            return path.split("/")[-2]
        iface = wait(getit).strip()
        print(f"{mac} -> {iface}")
        return iface

    def add_iface(self, activate=True):
        m = self.machine
        mac = m.add_netiface(networking=self.network.interface())
        # Wait for the interface to show up
        self.get_iface(m, mac)
        # Trigger udev to make sure that it has been renamed to its final name
        m.execute("udevadm trigger; udevadm settle")
        iface = self.get_iface(m, mac)
        if activate:
            self.nm_activate_eth(iface)
        return iface

    def wait_for_iface(self, iface, active=True, state=None, prefix="10.111."):
        sel = f"#networking-interfaces tr[data-interface='{iface}']"

        if state:
            text = state
        elif active:
            text = prefix
        else:
            text = "Inactive"

        try:
            with self.browser.wait_timeout(30):
                self.browser.wait_in_text(sel, text)
        except Error as e:
            print(f"Interface {iface} didn't show up.")
            print(self.machine.execute(f"grep . /sys/class/net/*/address; nmcli con; nmcli dev; nmcli dev show {iface} || true"))
            raise e

    def select_iface(self, iface):
        b = self.browser
        b.click(f"#networking-interfaces tr[data-interface='{iface}'] button")

    def iface_con_id(self, iface):
        con_id = self.machine.execute(f"nmcli -m tabular -t -f GENERAL.CONNECTION device show {iface}").strip()
        if con_id == "" or con_id == "--":
            return None
        else:
            return con_id

    def wait_for_iface_setting(self, setting_title, setting_value):
        b = self.browser
        b.wait_in_text(f"dt:contains('{setting_title}') + dd", setting_value)

    def configure_iface_setting(self, setting_title):
        b = self.browser
        b.click(f"dt:contains('{setting_title}') + dd button")

    def ensure_nm_uses_dhclient(self):
        m = self.machine
        m.write("/etc/NetworkManager/conf.d/99-dhcp.conf", "[main]\ndhcp=dhclient\n")
        m.execute("systemctl restart NetworkManager")

    def slow_down_dhclient(self, delay):
        self.machine.execute(f"""
        mkdir -p {self.vm_tmpdir}
        cp -a /usr/sbin/dhclient {self.vm_tmpdir}/dhclient.real
        printf '#!/bin/sh\\nsleep {delay}\\nexec {self.vm_tmpdir}/dhclient.real "$@"' > {self.vm_tmpdir}/dhclient
        chmod a+x {self.vm_tmpdir}/dhclient
        if selinuxenabled 2>&1; then chcon --reference /usr/sbin/dhclient {self.vm_tmpdir}/dhclient; fi
        mount -o bind {self.vm_tmpdir}/dhclient /usr/sbin/dhclient
        """)
        self.addCleanup(self.machine.execute, "umount /usr/sbin/dhclient")

    def wait_onoff(self, sel, val):
        self.browser.wait_visible(sel + " input[type=checkbox]" + (":checked" if val else ":not(:checked)"))

    def toggle_onoff(self, sel):
        self.browser.click(sel + " input[type=checkbox]")

    def login_and_go(self, *args, **kwargs):
        super().login_and_go(*args, **kwargs)
        self.nm_checkpoints_disable()
