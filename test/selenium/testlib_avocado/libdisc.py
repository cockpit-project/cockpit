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
# for targetcli and iscsi commands
# you have to install: yum -y install targetcli iscsi-initiator-utils
# !!!!!! at the end, please call "clear" function for destroy all created iSCSI targets
# usecase:
# import libdisc; a=libdisc.Disc(machine, 'cockpit'); print a.adddisc('disc1'); print a.adddisc('disc2'); a.deldisc('disc2'); a.clear();"

import re


class Disc:
    def __init__(self, machine, domain="default", ip="127.0.0.1", prefix="iqn.2015-03.com"):
        self.domain = domain
        self.machine = machine
        self.ip = ip
        self.targetlist = []
        self.prefix = prefix
        tmp = self.machine.execute("cat /etc/iscsi/initiatorname.iscsi | sed -r 's/^.*=//'")
        self.initiatorname = str(tmp)

    def addtarget(self, name, size='10G'):
        self.machine.execute("sudo targetcli /backstores/fileio/ create file_or_dev=/var/tmp/%s_%s.target size=%s sparse=true name=%s_%s" % (self.domain, name, size, self.domain, name))
        self.machine.execute("sudo targetcli /iscsi/ create %s.%s:%s" % (self.prefix, self.domain, name))
        self.machine.execute("sudo targetcli /iscsi/%s.%s:%s/tpg1/acls/ create %s" % (self.prefix, self.domain, name, self.initiatorname))
        self.machine.execute("sudo targetcli /iscsi/%s.%s:%s/tpg1/luns/ create /backstores/fileio/%s_%s" % (self.prefix, self.domain, name, self.domain, name))
        self.machine.execute("sudo targetcli saveconfig")
        self.targetlist.append(name)
        # fresh in order that
        # the iscsi can be added directly when create storge pool
        self.machine.execute(
            "sudo iscsiadm -m discovery -t sendtargets -p %s" % self.ip)
        # return the iscsi iqn for some method
        return '%s.%s:%s' % (self.prefix, self.domain, name)

    def createparttable(self, name, parttable='msdos'):
        self.machine.execute("sudo parted -s /var/tmp/%s_%s.target mktable %s" % (self.domain, name, parttable))

    def adddisc(self, targetsuffix, size='10G'):
        self.addtarget(targetsuffix, size)
        self.machine.execute("sudo iscsiadm -m discovery -t sendtargets -p %s" % self.ip)
        self.machine.execute("sudo iscsiadm -m node --targetname=%s.%s:%s --login" % (self.prefix, self.domain, targetsuffix))
        print(self.machine.execute("sudo iscsiadm -m node"))
        tmp = self.machine.execute("sleep 5; sudo iscsiadm -m session -P 3 | tail -1")
        tmp1 = re.search(r'Attached scsi disk\s+([a-z]*)\s+', tmp)
        return "/dev/%s" % str(tmp1.group(1))

    def deldisc(self, name):
        targetname = "%s.%s:%s" % (self.prefix, self.domain, name)
        self.machine.execute("sudo iscsiadm -m node -T %s --portal %s -u" % (targetname, self.ip))
        self.targetlist.remove(name)

    def clear(self):
        for foo in self.targetlist:
            self.deldisc(foo)
        self.machine.execute("sudo iscsiadm -m discovery -p %s -o delete" % self.ip)
        self.machine.execute("sudo targetcli clearconfig confirm=True")
        self.machine.execute("sudo targetcli saveconfig")


class DiscSimple():
    def __init__(self, machine, location='/var/tmp'):
        self.machine = machine
        self.location = location
        self.targetlist = []

    def adddisc(self, name, size=999):
        outfile = "%s/%s" % (self.location, name)
        self.machine.execute("sudo dd if=/dev/zero of=%s bs=1M count=1 seek=%d" % (outfile, size))
        self.machine.execute("sudo losetup -f %s; sleep 1" % outfile)
        tmp = self.machine.execute("sudo losetup -j %s" % outfile)
        tmp1 = re.search(r'(/dev/loop[0-9]+):\s+', tmp)
        self.targetlist.append(name)
        return tmp1.group(1)

    def deldisc(self, name):
        outfile = "%s%s" % (self.location, name)
        tmp = self.machine.execute("sudo losetup -j %s" % outfile)
        tmp1 = re.search(r'(/dev/loop[0-9]+):\s+', tmp)
        self.machine.execute("sudo losetup -d %s" % tmp1.group(1))
        self.targetlist.remove(name)

    def clear(self):
        for foo in self.targetlist:
            self.deldisc(foo)
