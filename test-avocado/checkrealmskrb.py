#!/usr/bin/python
# -*- coding: utf-8 -*-

# This file is part of Cockpit.
#
# Copyright (C) 2013 Red Hat, Inc.
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
from avocado import test
from avocado.utils import process

import os, sys, tempfile, socket, shutil, imp
topdir = "/usr/share/avocado/tests"
libdir = str(os.path.dirname(os.path.abspath(__file__)))+"/lib"
sys.path.append(libdir)
sys.path.append(topdir+"/lib")
from testlib import *
from libjournal import *

try:
    a=imp.load_source("", "%s/var.env" % libdir)
    domain=a.IPADOMAIN
    domainip=a.IPADOMAINIP
except:
    a=None
    domain="cockpit.lan"
    domainip="192.168.122.55"
    pass

domainkrb=domain.upper()
dnamedomainipa=socket.gethostbyaddr(domainip)[0]
dname=socket.gethostname()
password="foobarfoo"    


KRB5_TEMPLATE = """
[logging]
 default = FILE:%(dir)s/krb5.log
[libdefaults]
 dns_lookup_realm = false
 default_realm = %(dom)s
 rdns = false
[realms]
 %(dom)s = {
   kdc = %(addr)s
   master_kdc = %(addr)s
 }
[domain_realm]
 %(addr)s = %(dom)s
"""

JOIN_SCRIPT1 = """ curl -s --negotiate -u : https://%(namedom)s/ipa/json --header 'Referer: https://%(namedom)s/ipa' --header "Content-Type: application/json" --header "Accept: application/json" --data '{"params": [["HTTP/%(namemy)s@%(domkrb)s"], {"raw": false, "all": false, "version": "2.101", "force": true, "no_members": false}], "method": "service_add", "id": 0}' """
JOIN_SCRIPT2 = """ ipa-getkeytab -q -s %(namedom)s -p HTTP/%(namemy)s -k /etc/krb5.keytab"""

# This is here because our test framework can't run ipa VM's twice
class checkrealmskrb(test.Test):
    def setup(self):
        process.run("/bin/cp /etc/pam.d/cockpit{,.old}", shell=True, ignore_status=True)
        process.run("/bin/cp /etc/resolv.conf{,.old}", shell=True, ignore_status=True)
        
        process.run("echo -e 'domain %s\nsearch %s\nnameserver %s\n' > /etc/resolv.conf" % (domain, domain, domainip), shell=True, ignore_status=True)
        wait(lambda: process.run("nslookup -type=SRV _ldap._tcp.%s" % domain))
        # create user admin
        process.run("useradd %s -c 'Administrator'" % "admin", shell=True, ignore_status=True)
        process.run("gpasswd wheel -a %s" % "admin", shell=True, ignore_status=True)
        process.run("echo foobar | passwd --stdin %s" % "admin", shell=True)
        process.run("echo '%s' > /etc/pam.d/cockpit" % admins_only_pam, shell=True)

        self.tmpdir = tempfile.mkdtemp()
        self.ccache = "%s/krb5cc" % self.tmpdir
        os.environ['KRB5CCNAME'] = self.ccache
        self.config = "%s/krb5.conf" % self.tmpdir
        args = { "addr": domainip, "dir": self.tmpdir, "password": password, "dom": domainkrb }

        # Setup a kerberos config that doesn't require DNS
        os.environ['KRB5_CONFIG'] = self.config
        with open(self.config, "w") as f:
            data = KRB5_TEMPLATE % args
            f.write(data)

        process.run("systemctl start cockpit", shell=True ,ignore_status=True)
        process.run("echo '%s' | realm leave -U admin %s " % (password,domain), shell=True, ignore_status=True)
        process.run("echo '%s' | realm join -U admin %s " % (password,domain), shell=True)
        process.run("echo '%s' | kinit admin@%s" % (password,domainkrb), shell=True)
        process.run(JOIN_SCRIPT1 %{"namedom": dnamedomainipa, "namemy": dname,"domkrb": domainkrb}, shell=True)
        process.run(JOIN_SCRIPT2 %{"namedom": dnamedomainipa, "namemy": dname}, shell=True)


    def testNegotiate(self):
        p=process.run("/usr/bin/curl -s --negotiate -u : -D - --resolve %s:9090:%s http://%s:9090/login" % (dname,dname,dname), shell=True)
        self.assertIn("HTTP/1.1 200 OK", p.stdout)
        self.assertIn('"admin@%s"' % domain, p.stdout)


        
    def action(self):
        self.testNegotiate()
        
    def cleanup(self):
        process.run("systemctl stop cockpit", shell=True)
        process.run("/bin/cp -f /etc/pam.d/cockpit{.old,}", shell=True, ignore_status=True)
        process.run("/bin/cp -f /etc/resolv.conf{.old,}", shell=True, ignore_status=True)
        process.run("/bin/rm -fr %s" % self.tmpdir, shell=True, ignore_status=True)
        self.log.debug("END")
        

if __name__ == "__main__":
    job.main()