#
# Copyright (C) 2017 Red Hat, Inc.
# SPDX-License-Identifier: LGPL-2.1-or-later


import subprocess
from collections.abc import Sequence, Set

from machine.machine_core.machine_virtual import VirtMachine
from testlib import Error, MachineCase, wait


class NetworkHelpers(MachineCase):
    """Mix-in class for tests that require network setup"""

    def add_veth(self, name: str, dhcp_cidr: str | None = None, dhcp_range: Sequence[str] | None = None) -> None:
        """Add a veth device that is manageable with NetworkManager

        This is safe for @nondestructive tests, the interface gets cleaned up automatically.
        """
        if dhcp_range is None:
            dhcp_range = ['10.111.112.2', '10.111.127.254']
        self.machine.execute(rf"""
            mkdir -p /run/udev/rules.d/
            echo 'ENV{{ID_NET_DRIVER}}=="veth", ENV{{INTERFACE}}=="{name}", ENV{{NM_UNMANAGED}}="0"' > /run/udev/rules.d/99-nm-veth-{name}-test.rules
            udevadm control --reload
            ip link add name {name} type veth peer name v_{name}
            # Trigger udev to make sure that it has been renamed to its final name
            udevadm trigger --subsystem-match=net
            udevadm settle
            """)
        self.addCleanup(self.machine.execute, f"rm /run/udev/rules.d/99-nm-veth-{name}-test.rules; nmcli dev del {name}")
        if dhcp_cidr:
            # up the remote end, give it an IP, and start DHCP server
            self.machine.execute(f"ip a add {dhcp_cidr} dev v_{name}; ip link set v_{name} up")

            self.machine.execute("mkdir -p /run/dnsmasq")
            server = self.machine.spawn(f"dnsmasq --keep-in-foreground --log-queries --log-facility=- "
                                        f"--conf-file=/dev/null --dhcp-leasefile=/run/dnsmasq/leases.{name} --no-resolv "
                                        f"--bind-interfaces --except-interface=lo --interface=v_{name} --dhcp-range={dhcp_range[0]},{dhcp_range[1]},4h",
                                        f"dhcp-{name}.log")
            self.addCleanup(self.machine.execute, f"kill {server}; rm -rf /run/dnsmasq")
            self.machine.execute("if firewall-cmd --state >/dev/null 2>&1; then firewall-cmd --add-service=dhcp; fi")

    def nm_activate_eth(self, iface: str) -> None:
        """Create an NM connection for a given interface"""

        m = self.machine
        wait(lambda: m.execute(f'nmcli device | grep "{iface}.*disconnected"'))
        m.execute(f"nmcli con add type ethernet ifname {iface} con-name {iface}")
        m.execute(f"nmcli con up {iface} ifname {iface}")
        self.addCleanup(m.execute, f"nmcli con delete {iface}")

    def nm_checkpoints_disable(self) -> None:
        self.browser.eval_js("window.cockpit_tests_disable_checkpoints = true;")

    def nm_checkpoints_enable(self, settle_time: float = 3.0) -> None:
        self.browser.eval_js("window.cockpit_tests_disable_checkpoints = false;")
        self.browser.eval_js(f"window.cockpit_tests_checkpoint_settle_time = {settle_time};")


class NetworkCase(NetworkHelpers):
    def setUp(self) -> None:
        super().setUp()

        m = self.machine

        # clean up after nondestructive tests
        if self.is_nondestructive():
            def devs() -> Set[str]:
                return set(self.machine.execute("ls /sys/class/net/ | grep -v bonding_masters").strip().split())

            def cleanupDevs() -> None:
                new = devs() - self.orig_devs
                self.machine.execute(f"for d in {' '.join(new)}; do nmcli dev del $d; done")

            self.orig_devs = devs()
            self.restore_dir("/etc/NetworkManager", restart_unit="NetworkManager")
            self.restore_dir("/etc/sysconfig/network-scripts")
            self.restore_dir("/etc/netplan")
            self.restore_dir("/run/NetworkManager/system-connections")
            self.addCleanup(cleanupDevs)
        else:
            # Disable pre-loading packagekit, dnf needs-restarting (dnf 4) consumes tons of cpu/memory on RHEL-10-1
            self.disable_preload("packagekit")

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

        # Something unknown sometimes goes wrong with PCP, see #15625
        self.allow_journal_messages("pcp-archive: no such metric: network.interface.* Unknown metric name",
                                    "direct: instance name lookup failed: network.*")

    def setup_wireless_networks(self) -> None:
        m = self.machine

        # firewalld blocks local dnsmasq/hostapd
        m.execute("systemctl stop firewalld")
        self.addCleanup(m.execute, "systemctl start firewalld")

        # tell NM to ignore router and BSS interfaces
        self.write_file("/run/udev/rules.d/99-nm-wifi-test.rules", 'ENV{INTERFACE}=="wlan0*", ENV{NM_UNMANAGED}="1"',
                        post_restore_action="udevadm control --reload")
        m.execute("udevadm control --reload")

        # start fake wifi wlan0/1 pair and wait for it
        m.execute("modprobe mac80211_hwsim; while ! [ -e /sys/class/net/wlan0 ]; do sleep 0.1; done")
        self.addCleanup(m.execute, "rmmod mac80211_hwsim")

        # start hostapd with multiple BSSes
        self.write_file("/tmp/hostapd.conf", """
interface=wlan0
hw_mode=g
channel=1

# First network: WPA2-PSK
ssid=ZE WIFI!
wpa=2
wpa_passphrase=12345678

# Second network: WPA2-PSK
bss=wlan0_0
ssid=PrivateNet
wpa=2
wpa_passphrase=secret123

# Third network: Open
bss=wlan0_1
ssid=OpenNet

# Fourth network: second AP for same SSID
bss=wlan0_2
ssid=OpenNet

# Fifth network: Hidden WPA2-PSK
bss=wlan0_3
ssid=HiddenNet
ignore_broadcast_ssid=1
wpa=2
wpa_passphrase=hidden99""")
        hostapd_pid = m.spawn("hostapd /tmp/hostapd.conf", "hostapd.log")
        self.addCleanup(m.execute, f"kill {hostapd_pid}")

        # give router ends an IP
        m.execute("until [ -e /sys/class/net/wlan0_3 ]; do sleep 0.1; done")
        m.execute("ip addr add 10.0.42.1/24 dev wlan0")
        m.execute("ip addr add 10.0.42.2/24 dev wlan0_0")
        m.execute("ip addr add 10.0.42.3/24 dev wlan0_1")
        m.execute("ip addr add 10.0.42.4/24 dev wlan0_2")
        m.execute("ip addr add 10.0.42.5/24 dev wlan0_3")

        # start DNS server
        dnsmasq_pid = m.spawn("dnsmasq --keep-in-foreground --log-queries --log-facility=- "
                              "--conf-file=/dev/null --dhcp-leasefile=/tmp/leases "
                              "--bind-interfaces --except-interface=lo "
                              "--interface=wlan0 --interface=wlan0_0 --interface=wlan0_1 --interface=wlan0_2 --interface=wlan0_3 "
                              "--dhcp-range=10.0.42.10,10.0.42.200", "wifi-dnsmasq.log")
        self.addCleanup(m.execute, f"kill {dnsmasq_pid}")

        # client-side interface
        self.iface = "wlan1"

    def get_iface(self, mac: str) -> str:
        def getit() -> str:
            path = self.machine.execute(f"grep -li '{mac}' /sys/class/net/*/address")
            return path.split("/")[-2]
        iface = wait(getit).strip()
        print(f"{mac} -> {iface}")
        return iface

    def add_iface(self, activate: bool = True) -> str:
        m = self.machine
        assert isinstance(m, VirtMachine)
        assert self.network is not None
        mac = m.add_netiface(networking=self.network.interface())
        # Wait for the interface to show up
        self.get_iface(mac)
        # Trigger udev to make sure that it has been renamed to its final name
        m.execute("udevadm trigger; udevadm settle")
        iface = self.get_iface(mac)
        if activate:
            self.nm_activate_eth(iface)
        return iface

    def wait_for_iface(self, iface: str, active: bool = True, state: str | None = None, prefix: str = "10.111.") -> None:
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

    def select_iface(self, iface: str) -> None:
        b = self.browser
        b.click(f"#networking-interfaces tr[data-interface='{iface}'] button")

    def iface_con_id(self, iface: str) -> str | None:
        con_id = self.machine.execute(f"nmcli -m tabular -t -f GENERAL.CONNECTION device show {iface}").strip()
        if con_id == "" or con_id == "--":
            return None
        else:
            return con_id

    def wait_for_iface_setting(self, setting_title: str, setting_value: str) -> None:
        b = self.browser
        b.wait_in_text(f"[data-label='{setting_title}']", setting_value)

    def configure_iface_setting(self, setting_title: str) -> None:
        b = self.browser
        b.click(f"[data-label='{setting_title}'] button")

    def ensure_nm_uses_dhclient(self) -> None:
        m = self.machine
        m.write("/etc/NetworkManager/conf.d/99-dhcp.conf", "[main]\ndhcp=dhclient\n")
        m.execute("systemctl restart NetworkManager")

    def slow_down_dhclient(self, delay: int) -> None:
        self.machine.execute(f"""
        mkdir -p {self.vm_tmpdir}
        cp -a /usr/sbin/dhclient {self.vm_tmpdir}/dhclient.real
        printf '#!/bin/sh\\nsleep {delay}\\nexec {self.vm_tmpdir}/dhclient.real "$@"' > {self.vm_tmpdir}/dhclient
        chmod a+x {self.vm_tmpdir}/dhclient
        if selinuxenabled 2>&1; then chcon --reference /usr/sbin/dhclient {self.vm_tmpdir}/dhclient; fi
        mount -o bind {self.vm_tmpdir}/dhclient /usr/sbin/dhclient
        """)
        self.addCleanup(self.machine.execute, "umount /usr/sbin/dhclient")

    def wait_onoff(self, sel: str, *, val: bool) -> None:
        self.browser.wait_visible(sel + " input[type=checkbox]" + (":checked" if val else ":not(:checked)"))

    def toggle_onoff(self, sel: str) -> None:
        self.browser.click(sel + " input[type=checkbox]")

    def login_and_go(
        self,
        path: str | None = None,
        *,
        user: str | None = None,
        password: str | None = None,
        host: str | None = None,
        superuser: bool = True,
        urlroot: str | None = None,
        tls: bool = False,
        enable_root_login: bool = False
    ) -> None:
        super().login_and_go(path=path, user=user, password=password,
                             host=host, superuser=superuser, urlroot=urlroot,
                             tls=tls, enable_root_login=enable_root_login)
        self.nm_checkpoints_disable()
