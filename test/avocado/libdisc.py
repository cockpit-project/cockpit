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
# for targetcli and iscsi commands
# you have to install: yum -y install targetcli iscsi-initiator-utils
# !!!!!! at the end, please call "clear" function for destory all created iSCSI targets
# usecase:
# import libdisc; a=libdisc.Disc('cockpit'); print a.adddisc('disc1'); print a.adddisc('disc2'); a.deldisc('disc2'); a.clear();"

import  re
from avocado.utils import process

class Disc():
    def __init__(self, domain="default",ip="127.0.0.1", prefix="iqn.2015-03.com"):
        self.domain = domain
        self.ip=ip
        self.targetlist=[]
        self.prefix = prefix
        tmp = process.run("cat /etc/iscsi/initiatorname.iscsi | sed -r 's/^.*=//'", shell = True)
        self.initiatorname=str(tmp.stdout)

    def addtarget(self, name):
        process.run("targetcli /backstores/fileio/ create file_or_dev=/var/tmp/%s_%s.target size=10G sparse=true name=%s_%s" % (self.domain, name, self.domain, name), shell = True)
        process.run("targetcli /iscsi/ create %s.%s:%s" % (self.prefix, self.domain, name), shell=True)
        process.run("targetcli /iscsi/%s.%s:%s/tpg1/acls/ create %s" % (self.prefix, self.domain, name, self.initiatorname), shell = True)
        process.run("targetcli /iscsi/%s.%s:%s/tpg1/luns/ create /backstores/fileio/%s_%s" % (self.prefix, self.domain, name, self.domain, name), shell = True)
        process.run("targetcli saveconfig", shell = True)
        self.targetlist.append(name)

    def createparttable(self,name,parttable='msdos'):
        process.run("parted /var/tmp/%s_%s.target mktable %s" % (self.domain, name, parttable), shell = True)

    def adddisc(self, targetsuffix):
        self.addtarget(targetsuffix)
        process.run("iscsiadm -m discovery -t sendtargets -p %s" % self.ip, shell = True)
        process.run("iscsiadm -m node --targetname=%s.%s:%s --login" % (self.prefix, self.domain, targetsuffix), shell = True)
        tmp = process.run("iscsiadm -m node" , shell = True)
        print tmp.stdout
        tmp = process.run("sleep 5; iscsiadm -m session -P 3 | tail -1" , shell = True)
        tmp1 = re.search('Attached scsi disk\s+([a-z]*)\s+', tmp.stdout)
        return "/dev/%s" % str(tmp1.group(1))

    def deldisc(self, name):
        targetname="%s.%s:%s" % (self.prefix, self.domain, name)
        process.run("iscsiadm -m node -T %s --portal %s -u" % (targetname, self.ip), shell = True)
        self.targetlist.remove(name)

    def clear(self):
        for foo in self.targetlist:
            self.deldisc(foo)
        process.run("iscsiadm -m discovery -p %s -o delete" % self.ip, shell = True)
        process.run("targetcli clearconfig confirm=True", shell = True)
        process.run("targetcli saveconfig", shell = True)

class DiscSimple():
    def __init__(self, location='/var/tmp'):
        self.location=location
        self.targetlist=[]

    def adddisc(self,name, size=999):
        outfile="%s/%s" % (self.location, name)
        process.run("dd if=/dev/zero of=%s bs=1M count=1 seek=%d" % (outfile, size), shell = True)
        process.run("sudo losetup -f %s; sleep 1" % outfile, shell = True)
        tmp = process.run("sudo losetup -j %s" % outfile, shell = True)
        tmp1 = re.search('(/dev/loop[0-9]+):\s+', tmp.stdout)
        self.targetlist.append(name)
        return tmp1.group(1)

    def deldisc(self,name):
        outfile="%s%s" % (self.location, name)
        tmp = process.run("sudo losetup -j %s" % outfile, shell = True)
        tmp1 = re.search('(/dev/loop[0-9]+):\s+', tmp.stdout)
        process.run("sudo losetup -d %s" % tmp1.group(1), shell = True)
        self.targetlist.remove(name)

    def clear(self):
        for foo in self.targetlist:
            self.deldisc(foo)
