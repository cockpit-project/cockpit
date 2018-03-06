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

import os
from testlib import *

class PackageCase(MachineCase):
    provision = {
        "machine1": { "address": "10.111.113.2/20", "dns": "10.111.113.2" }
    }

    def setUp(self):
        MachineCase.setUp(self)

        self.repo_dir = "/var/tmp/repo"

        # expected backend; hardcode this on image names to check the auto-detection
        if self.machine.image.startswith("debian") or self.machine.image.startswith("ubuntu"):
            self.backend = "apt"
        elif self.machine.image.startswith("fedora"):
            self.backend = "dnf"
        elif self.machine.image in ["centos-7", "rhel-7", "rhel-7-4", "rhel-7-5"]:
            self.backend = "yum"
        else:
            raise NotImplementedError("unknown image " + self.machine.image)

        # disable all existing repositories to avoid hitting the network
        if self.backend == "apt":
            self.machine.execute("rm -f /etc/apt/sources.list.d/*; echo > /etc/apt/sources.list; apt-get update")
        else:
            self.machine.execute("rm -rf /etc/yum.repos.d/* /var/cache/yum/*")

        # have PackageKit start from a clean slate
        self.machine.execute("systemctl stop packagekit; rm -rf /var/cache/PackageKit")

        # PackageKit refuses to operate when being offline (as on our test images); it's hard to fake
        # NetworkManager's "is online" state, so disable it and let PackageKit fall back to the "unix"
        # network stack; add a bogus default route to coerce it into being "online".
        self.machine.execute("systemctl stop NetworkManager; ip route add default via 10.111.113.1 dev eth1")

        self.updateInfo = {}

    #
    # Helper functions for creating packages/repository
    #

    def createPackage(self, name, version, release, install=False, postinst=None, depends="", content=None, **updateinfo):
        '''Create a dummy package in repo_dir on self.machine

        If install is True, install the package. Otherwise, update the package
        index in repo_dir.
        '''
        if self.backend == "apt":
            self.createDeb(name, version + '-' + release, depends, postinst, install, content)
        else:
            self.createRpm(name, version, release, depends, postinst, install, content)
        if updateinfo:
            self.updateInfo[(name, version, release)] = updateinfo

    def createDeb(self, name, version, depends, postinst, install, content):
        '''Create a dummy deb in repo_dir on self.machine

        If install is True, install the package. Otherwise, update the package
        index in repo_dir.
        '''
        deb = "{0}/{1}_{2}_all.deb".format(self.repo_dir, name, version)
        if postinst:
            postinstcode = "printf '#!/bin/sh\n{0}' > /tmp/b/DEBIAN/postinst; chmod 755 /tmp/b/DEBIAN/postinst".format(postinst)
        else:
            postinstcode = ''
        if content is not None:
            for path, data in content.items():
                dest = "/tmp/b/" + path
                self.machine.execute("mkdir -p '{0}'".format(os.path.dirname(dest)))
                self.machine.write(dest, data)
        cmd = '''mkdir -p /tmp/b/DEBIAN {repo}
                 printf "Package: {name}\nVersion: {ver}\nPriority: optional\nSection: test\nMaintainer: foo\nDepends: {deps}\nArchitecture: all\nDescription: dummy {name}\n" > /tmp/b/DEBIAN/control
                 {post}
                 touch /tmp/b/stamp-{name}-{ver}
                 dpkg -b /tmp/b {deb}
                 rm -r /tmp/b
                 '''.format(name=name, ver=version, deps=depends, deb=deb, post=postinstcode, repo=self.repo_dir)
        if install:
            cmd += "dpkg -i " + deb
        self.machine.execute(cmd)

    def createRpm(self, name, version, release, requires, post, install, content):
        '''Create a dummy rpm in repo_dir on self.machine

        If install is True, install the package. Otherwise, update the package
        index in repo_dir.
        '''
        if post:
            postcode = '\n%%post\n' + post
        else:
            postcode = ''
        if requires:
            requires = "Requires: %s\n" % requires
        installcmds = "touch $RPM_BUILD_ROOT/stamp-{0}-{1}-{2}\n".format(name, version, release)
        installedfiles = "/stamp-{0}-{1}-{2}\n".format(name, version, release)
        if content is not None:
            for path, data in content.items():
                installcmds += 'mkdir -p $(dirname "$RPM_BUILD_ROOT/{0}")\n'.format(path)
                installcmds += 'cat >"$RPM_BUILD_ROOT/{0}" <<\'EOF\'\n'.format(path) + data + '\nEOF\n'
                installedfiles += "{0}\n".format(path)
        spec = """
Summary: dummy {0}
Name: {0}
Version: {1}
Release: {2}
License: BSD
BuildArch: noarch
{4}

%%install
{5}

%%description
Test package.

%%files
{6}

{3}
""".format(name, version, release, postcode, requires, installcmds, installedfiles)
        self.machine.write("/tmp/spec", spec)
        cmd = """
rpmbuild --quiet -bb /tmp/spec
mkdir -p {0}
cp ~/rpmbuild/RPMS/noarch/*.rpm {0}
rm -rf ~/rpmbuild
"""
        if install:
            cmd += "rpm -i {0}/{1}-{2}-{3}.*.rpm"
        self.machine.execute(cmd.format(self.repo_dir, name, version, release))

    def createAptChangelogs(self):
        # apt metadata has no formal field for bugs/CVEs, they are parsed from the changelog
        for ((pkg, ver, rel), info) in self.updateInfo.items():
            changes = info.get("changes", "some changes")
            if info.get("bugs"):
                changes += " (Closes: {0})".format(", ".join(["#" + str(b) for b in info["bugs"]]))
            if info.get("cves"):
                changes += "\n  * " + ", ".join(info["cves"])

            path = "{0}/changelogs/{1}/{2}/{2}_{3}-{4}".format(self.repo_dir, pkg[0], pkg, ver, rel)
            contents = '''{0} ({1}-{2}) unstable; urgency=medium

  * {3}

 -- Joe Developer <joe@example.com>  Wed, 31 May 2017 14:52:25 +0200
'''.format(pkg, ver, rel, changes)
            self.machine.execute("mkdir -p $(dirname {0}); echo '{1}' > {0}".format(path, contents))

    def createYumUpdateInfo(self):
        xml = '<?xml version="1.0" encoding="UTF-8"?>\n<updates>\n'
        for ((pkg, ver, rel), info) in self.updateInfo.items():
            refs = ""
            for b in info.get("bugs", []):
                refs += '      <reference href="https://bugs.example.com?bug={0}" id="{0}" title="Bug#{0} Description" type="bugzilla"/>\n'.format(b)
            for c in info.get("cves", []):
                refs += '      <reference href="https://cve.mitre.org/cgi-bin/cvename.cgi?name={0}" id="{0}" title="{0}" type="cve"/>\n'.format(c)
            if info.get("securitySeverity"):
                refs += '      <reference href="https://access.redhat.com/security/updates/classification/#{0}" id="" title="" type="other"/>\n'.format(info["securitySeverity"])
            for e in info.get("errata", []):
                refs += '      <reference href="https://access.redhat.com/errata/{0}" id="{0}" title="{0}" type="self"/>\n'.format(e)

            xml += '''  <update from="test@example.com" status="stable" type="{severity}" version="2.0">
    <id>UPDATE-{pkg}-{ver}-{rel}</id>
    <title>{pkg} {ver}-{rel} update</title>
    <issued date="2017-01-01 12:34:56"/>
    <description>{desc}</description>
    <references>
{refs}
    </references>
    <pkglist>
     <collection short="0815">
        <package name="{pkg}" version="{ver}" release="{rel}" epoch="0" arch="noarch">
          <filename>{pkg}-{ver}-{rel}.noarch.rpm</filename>
        </package>
      </collection>
    </pkglist>
  </update>
'''.format(pkg=pkg, ver=ver, rel=rel, refs=refs,
            desc=info.get("changes", ""), severity=info.get("severity", "bugfix"))

        xml += '</updates>\n'
        return xml

    def enableRepo(self):
        if self.backend == "apt":
            self.createAptChangelogs()
            # HACK: on Debian jessie, apt has an error propagation bug that causes "Err file: Packages" for each absent
            # compression format with file:// sources, which breaks PackageKit; work around by providing all formats
            self.machine.execute('''set -e; echo 'deb [trusted=yes] file://{0} /' > /etc/apt/sources.list.d/test.list
                                    cd {0}; apt-ftparchive packages . > Packages
                                    gzip -c Packages > Packages.gz; bzip2 -c Packages > Packages.bz2; xz -c Packages > Packages.xz
                                    O=$(apt-ftparchive -o APT::FTPArchive::Release::Origin=cockpittest release .); echo "$O" > Release
                                    echo 'Changelogs: http://localhost:12345/changelogs/@CHANGEPATH@' >> Release
                                    setsid python -m SimpleHTTPServer 12345 >/dev/null 2>&1 < /dev/null &
                                    '''.format(self.repo_dir))
            self.machine.wait_for_cockpit_running(port=12345)  # wait for changelog HTTP server to start up
        else:
            self.machine.execute('''set -e; printf '[updates]\nname=cockpittest\nbaseurl=file://{0}\nenabled=1\ngpgcheck=0\n' > /etc/yum.repos.d/cockpittest.repo
                                    echo '{1}' > /tmp/updateinfo.xml
                                    createrepo_c {0}
                                    modifyrepo_c /tmp/updateinfo.xml {0}/repodata
                                    $(which dnf 2>/dev/null|| which yum) clean all'''.format(self.repo_dir, self.createYumUpdateInfo()))
