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

# This library have to be run under root or other user who has rights
# for modprobe, brctl, ip tools
# !!!!!! at the end, please call "clear" function for destroy created ifaces and bridge
# usecase:
#  a=Network('brname'); a.addiface('x1'); DOWHATEWERYOUWANTWITHx1 ;a.clear()

import  re
from avocado.utils import process

class Network():
    def __init__(self, brname=None):
        self.brname = brname
        self.interfaces=[]
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
        if re.search('%s\s+' % self.brname ,out.stdout) is None:
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
            process.run("brctl addif %s %s" % (self.brname,ifname), shell=True)
        self.interfaces.append(ifname)

    def isifinbridge(self,ifname):
        if self.brname:
            out = process.run("brctl show %s" % self.brname, shell=True)
            if re.search('\s+%s$' % ifname ,out.stdout):
                return True
        return False

    def deliface(self, ifname):
        if ifname in self.interfaces:
            if self.isifinbridge(ifname):
                process.run("brctl delif %s %s" % (self.brname,ifname), shell=True)
            process.run("ip link set dev %s down" % ifname, shell=True)
            process.run("ip link set dev %sbr down" % ifname, shell=True)
            process.run("ip link del dev %sbr type veth" % ifname, shell=True)
            self.interfaces.remove(ifname)
        else:
            raise RuntimeError("Unable to remove interface %s (does not exist)")

    def deleteallinterfaces(self):
        for interface in self.interfaces:
            self.deliface(interface)
