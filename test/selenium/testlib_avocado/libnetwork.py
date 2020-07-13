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

# This library have to be run under root or other user who has rights
# for modprobe, brctl, ip tools
# !!!!!! at the end, please call "clear" function for destroy created ifaces and bridge
# usecase:
#  a=Network('brname'); a.addiface('x1'); DOWHATEWERYOUWANTWITHx1 ;a.clear()

import re
import subprocess
import warnings
from unittest import TestCase

from avocado.utils import process


class Network():
    def __init__(self, brname=None):
        self.brname = brname
        self.interfaces = []
        process.run("modprobe veth", shell=True)
        if self.brname and self.checkifbridgeexist():
            print("adding bridge " + self.brname)
            self.createbridge()

    def clear(self):
        self.deleteallinterfaces()
        if self.brname and not self.checkifbridgeexist():
            print("deleting bridge " + self.brname)
            self.delbridge()

    def checkifbridgeexist(self):
        out = process.run("brctl show", shell=True)
        if re.search('%s\s+' % self.brname, out.stdout.decode("utf-8")) is None:
            return True
        else:
            return False

    def createbridge(self):
        process.run("brctl addbr %s" % self.brname, shell=True)
        process.run("brctl stp %s off" % self.brname, shell=True)
        process.run("ip link set dev %s up" % self.brname, shell=True)

    def delbridge(self):
        process.run("ip link set dev %s down" % self.brname, shell=True)
        process.run("brctl delbr %s" % self.brname, shell=True)

    def addiface(self, ifname, bridge=True):
        if ifname in self.interfaces:
            raise RuntimeError("Unable to add network interface %s (already exists)")
        process.run("ip link add name %sbr type veth peer name %s" % (ifname, ifname), shell=True)
        process.run("ip link set dev %sbr up" % ifname, shell=True)
        process.run("ip link set dev %s up" % ifname, shell=True)
        if self.brname and bridge:
            process.run("brctl addif %s %s" % (self.brname, ifname), shell=True)
        self.interfaces.append(ifname)

    def isifinbridge(self, ifname):
        if self.brname:
            out = process.run("brctl show %s" % self.brname, shell=True)
            if re.search('\s+%s$' % ifname, out.stdout.decode("utf-8")):
                return True
        return False

    def deliface(self, ifname):
        if ifname in self.interfaces:
            if self.isifinbridge(ifname):
                process.run("brctl delif %s %s" % (self.brname, ifname), shell=True)
            process.run("ip link set dev %s down" % ifname, shell=True)
            process.run("ip link set dev %sbr down" % ifname, shell=True)
            process.run("ip link del dev %sbr type veth" % ifname, shell=True)
            self.interfaces.remove(ifname)
        else:
            raise RuntimeError("Unable to remove interface %s (does not exist)")

    def deleteallinterfaces(self):
        for interface in self.interfaces:
            self.deliface(interface)


class BaseNetworkClass:
    def __init__(self, machine, name):
        self.machine = machine
        self.name = name

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.cleanup()

    def execute(self, command, fail=True, timeout=120, decode=True):
        try:
            if self.machine:
                out = self.machine.execute(command, direct=True, timeout=timeout)
            else:
                out = subprocess.check_output(command,
                                              stdin=subprocess.PIPE,
                                              stderr=subprocess.PIPE,
                                              shell=True,
                                              timeout=timeout)
        except subprocess.CalledProcessError as exc:
            if fail:
                raise exc
            else:
                return exc.output.decode() if decode and isinstance(exc.output, bytes) else exc.output
        except RuntimeError as exc:
            if fail:
                raise exc
            else:
                warnings.warn("Timeout exceeded (command: {})".format(command))
                return None
        return out.decode() if decode and isinstance(out, bytes) else out

    def _nmcli_execute(self, command_params, fail=True):
        return self.execute("sudo nmcli {}".format(command_params), fail=fail)

    def _nmcli_con_cmd(self, command, name, additional_params="", fail=True):
        return self._nmcli_execute("con {command} {name} {add}".
                                   format(command=command,
                                          name=name,
                                          add=additional_params),
                                   fail=fail)

    def con_delete(self, name=None, fail=True):
        name = name or self.name
        self._nmcli_con_cmd("del", name, fail=fail)

    def con_down(self, name=None, fail=True):
        name = name or self.name
        self._nmcli_con_cmd("down", name, fail=fail)

    def con_up(self, name=None, fail=True):
        name = name or self.name
        self._nmcli_con_cmd("up", name, fail=fail)

    def cleanup(self):
        self.con_down(fail=False)
        self.con_delete(fail=False)

    def list_all_devices(self):
        devices = []
        for line in self._nmcli_execute("device status").splitlines()[1:]:
            devices.append(line.split(" ", 1)[0])
        return devices

    def list_all_connections(self):
        conn = []
        for line in self._nmcli_execute("con show").splitlines()[1:]:
            conn.append(line.rsplit(maxsplit=3))
        return conn

    def remove_connections(self, regexp):
        for item in self.list_all_connections():
            if re.search(regexp, item[0]):
                warnings.warn("Delete prefixed connection: {}".format(item))
                self.con_down(name=item[1], fail=False)
                self.con_delete(name=item[1], fail=False)

    def set_ipv4(self, ip, gw):
        self._nmcli_con_cmd("mod", self.name, "ipv4.method manual ipv4.addresses {ip}  ipv4.gateway {gw}".
                            format(ip=ip, gw=gw))
        self.con_up()

    @staticmethod
    def get_name(iface):
        if isinstance(iface, str):
            return iface
        return iface.name


class Ethernet(BaseNetworkClass):
    def __init__(self, machine, name):
        super().__init__(machine, name)
        self._nmcli_con_cmd(command="add con-name", name=name,
                            additional_params="type ethernet ifname {name}".format(name=name))

    def cleanup(self):
        self.con_down(name=self.name, fail=False)
        self.con_delete(name=self.name, fail=False)


class Veth(BaseNetworkClass):
    _pair_items = [0, 1]

    def __init__(self, machine, name):
        super().__init__(machine, name)
        self._name_left = self.name + str(self._pair_items[0])
        self._name_right = self.name + str(self._pair_items[1])
        self.execute("sudo ip link add {i1} type veth peer name {i2}".format(i1=self._name_left,
                                                                             i2=self._name_right))

        self.execute("sudo ip link set dev {item} up".format(item=self._name_left))
        self.left = Ethernet(machine=machine, name=self._name_left)
        self.execute("sudo ip link set dev {item} up".format(item=self._name_right))
        self.right = Ethernet(machine=machine, name=self._name_right)

    def con_delete(self, name=None, fail=True):
        raise NotImplementedError("Veth object does not support this operation directly,"
                                  " use pair item attribute: left or right ethernet object")

    def con_down(self, name=None, fail=True):
        raise NotImplementedError("Veth object does not support this operation directly,"
                                  " use pair item attribute: left or right ethernet object")

    def con_up(self, name=None, fail=True):
        raise NotImplementedError("Veth object does not support this operation directly,"
                                  " use pair item attribute: left or right ethernet object")

    def cleanup(self, *args):
        for item in [self.left, self.right]:
            item.cleanup()
            self.execute("sudo ip link set dev {item} down".format(item=item.name))
        self.execute("sudo ip link del {i1} type veth peer name {i2}".format(i1=self._name_left,
                                                                             i2=self._name_right))


class Bond(BaseNetworkClass):
    def __init__(self, machine, name, mode="active-backup"):
        super().__init__(machine, name)
        self._nmcli_con_cmd(command="add con-name",
                            name=self.name,
                            additional_params="type bond ifname {name} mode {mode}".format(name=self.name, mode=mode))

    def deactivate_interfaces(self):
        for item in self.list_members():
            self.con_down(item, fail=False)
        self.con_down(fail=False)

    def attach_member(self, iface):
        iface = BaseNetworkClass.get_name(iface)
        self._nmcli_con_cmd(command="add con-name",
                            name=self.name + iface,
                            additional_params="type bond-slave ifname {member} master {group}".
                            format(member=iface, group=self.name))
        self.con_up(self.name + iface)

    def detach_member(self, iface):
        iface = BaseNetworkClass.get_name(iface)
        self.con_down(self.name + iface)
        self.con_delete(self.name + iface)

    def list_members(self):
        try:
            return self.execute("cat /sys/class/net/{}/bonding/slaves".format(self.name)).strip().split()
        except subprocess.CalledProcessError:
            return []

    def cleanup(self):
        for item in self.list_members():
            self.detach_member(item)
        super().cleanup()


class Bridge(BaseNetworkClass):
    def __init__(self, machine, name):
        super().__init__(machine, name)
        self._nmcli_con_cmd(command="add con-name",
                            name=self.name,
                            additional_params="type bridge ifname {name}".format(name=self.name))

    def deactivate_interfaces(self):
        for item in self.list_members():
            self.con_down(item, fail=False)
        self.con_down(fail=False)

    def attach_member(self, iface):
        iface = BaseNetworkClass.get_name(iface)
        self._nmcli_con_cmd(command="add con-name",
                            name=self.name + iface,
                            additional_params="type bridge-slave ifname {member} master {group}".
                            format(member=iface, group=self.name))
        self.con_up(self.name + iface)

    def detach_member(self, iface):
        iface = BaseNetworkClass.get_name(iface)
        self.con_down(self.name + iface)
        self.con_delete(self.name + iface)

    def list_members(self):
        try:
            return self.execute("ls /sys/class/net/{}/brif/".format(self.name)).strip().split()
        except subprocess.CalledProcessError:
            return []

    def cleanup(self):
        for item in self.list_members():
            self.detach_member(item)
        super().cleanup()


class TestVeth(TestCase):

    def test_plain(self):
        iface_name = "ttve"
        a = Veth(None, iface_name)
        self.assertIn(iface_name + "0", BaseNetworkClass(None, "None").list_all_devices())
        self.assertEqual(iface_name + "0", a.left.name)
        a.cleanup()
        self.assertNotIn(iface_name + "0", BaseNetworkClass(None, "None").list_all_devices())

    def test_with(self):
        iface_name = "ttvb"
        with Veth(None, iface_name):
            self.assertIn(iface_name + "0", BaseNetworkClass(None, "None").list_all_devices())
        self.assertNotIn(iface_name + "0", BaseNetworkClass(None, "None").list_all_devices())


class TestBond(TestCase):

    def test_plain(self):
        iface_name = "ttba"
        a = Bond(None, iface_name)
        self.assertIn(iface_name, BaseNetworkClass(None, "None").list_all_devices())
        a.cleanup()
        self.assertNotIn(iface_name, BaseNetworkClass(None, "None").list_all_devices())

    def test_with(self):
        iface_name = "ttbb"
        with Bond(None, iface_name):
            self.assertIn(iface_name, BaseNetworkClass(None, "None").list_all_devices())
        self.assertNotIn(iface_name, BaseNetworkClass(None, "None").list_all_devices())

    def test_members(self):
        iface_name = "ttbx"
        member1_name = "tti1"
        member2_name = "tti2"
        with Bond(None, iface_name) as bond:
            with Veth(None, member1_name) as member1, Veth(None, member2_name) as member2:
                self.assertIn(iface_name, BaseNetworkClass(None, "None").list_all_devices())
                bond.attach_member(member1.left.name)
                bond.attach_member(member2.left.name)
                self.assertIn(member1.left.name, bond.list_members())
                self.assertIn(member2.left.name, bond.list_members())

        self.assertNotIn(iface_name, BaseNetworkClass(None, "None").list_all_devices())
        self.assertNotIn(member2_name + "0", BaseNetworkClass(None, "None").list_all_devices())


class TestBridge(TestCase):
    def test_plain(self):
        iface_name = "ttma"
        a = Bridge(None, iface_name)
        self.assertIn(iface_name, BaseNetworkClass(None, "None").list_all_devices())
        a.cleanup()
        self.assertNotIn(iface_name, BaseNetworkClass(None, "None").list_all_devices())

    def test_with(self):
        iface_name = "ttmb"
        with Bridge(None, iface_name):
            self.assertIn(iface_name, BaseNetworkClass(None, "None").list_all_devices())
        self.assertNotIn(iface_name, BaseNetworkClass(None, "None").list_all_devices())

    def test_members(self):
        iface_name = "ttmx"
        member1_name = "tti3"
        member2_name = "tti4"
        with Bridge(None, iface_name) as bridge:
            with Veth(None, member1_name) as member1, Veth(None, member2_name) as member2:
                self.assertIn(iface_name, BaseNetworkClass(None, "None").list_all_devices())
                bridge.attach_member(member1.left)
                bridge.attach_member(member2.left)
                self.assertIn(member1.left.name, bridge.list_members())
                self.assertIn(member2.left.name, bridge.list_members())

        self.assertNotIn(iface_name, BaseNetworkClass(None, "None").list_all_devices())
        self.assertNotIn(member2_name + "0", BaseNetworkClass(None, "None").list_all_devices())


class GenericFunctions(TestCase):
    def test_ip4(self):
        bond = "ttby"
        with Bond(None, bond) as a:
            a.set_ipv4("192.168.222.150/24", "192.168.222.1")
            self.assertIn("192.168.222.150", BaseNetworkClass(None, "None").execute("ip a"))

    def test_delete_match(self):
        bond = "ttbra"
        with Bond(None, bond) as a:
            self.assertIn(bond, BaseNetworkClass(None, "None").list_all_devices())
            a.remove_connections("tt")
            self.assertNotIn(bond, BaseNetworkClass(None, "None").list_all_devices())

    def test_complex(self):
        with Veth(None, "ttvth") as veth:
            with Bond(None, "ttbnd") as bond, Bridge(None, "ttmost") as bridge:
                bond.attach_member(veth.left)
                bridge.attach_member(veth.right)
                bridge.set_ipv4("192.168.225.5/24", "192.168.225.1")
                self.assertIn("192.168.225.5", BaseNetworkClass(None, "None").execute("ip a"))
