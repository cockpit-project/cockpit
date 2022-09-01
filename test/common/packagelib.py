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
import textwrap
import warnings

from testlib import MachineCase


class PackageCase(MachineCase):
    def setUp(self):
        super().setUp()

        self.repo_dir = os.path.join(self.vm_tmpdir, "repo")

        if self.machine.ostree_image:
            warnings.warn("PackageCase: OSTree images can't install additional packages")
            return

        # expected backend; hardcode this on image names to check the auto-detection
        if self.machine.image.startswith("debian") or self.machine.image.startswith("ubuntu"):
            self.backend = "apt"
            self.primary_arch = "all"
            self.secondary_arch = "amd64"
        elif self.machine.image.startswith("fedora") or self.machine.image.startswith("rhel-") or self.machine.image.startswith("centos-"):
            self.backend = "dnf"
            self.primary_arch = "noarch"
            self.secondary_arch = "x86_64"
        elif self.machine.image == "arch":
            self.backend = "alpm"
            self.primary_arch = "any"
            self.secondary_arch = "x86_64"
        else:
            raise NotImplementedError("unknown image " + self.machine.image)

        if "debian" in self.image or "ubuntu" in self.image:
            # PackageKit refuses to work when offline, and main interface is not managed by NM on these images
            self.machine.execute("nmcli con add type dummy con-name fake ifname fake0 ip4 1.2.3.4/24 gw4 1.2.3.1")
            self.addCleanup(self.machine.execute, "nmcli con delete fake")

        # HACK: packagekit often hangs on shutdown; https://bugzilla.redhat.com/show_bug.cgi?id=1717185
        self.write_file("/etc/systemd/system/packagekit.service.d/timeout.conf", "[Service]\nTimeoutStopSec=5\n")

        # disable all existing repositories to avoid hitting the network
        if self.backend == "apt":
            self.restore_dir("/var/lib/apt", reboot_safe=True)
            self.restore_dir("/var/cache/apt", reboot_safe=True)
            self.restore_dir("/etc/apt", reboot_safe=True)
            self.machine.execute("echo > /etc/apt/sources.list; rm -f /etc/apt/sources.list.d/*; apt-get clean; apt-get update")
        elif self.backend == "alpm":
            self.restore_dir("/var/lib/pacman", reboot_safe=True)
            self.restore_dir("/var/cache/pacman", reboot_safe=True)
            self.restore_dir("/etc/pacman.d", reboot_safe=True)
            self.restore_dir("/var/lib/PackageKit/alpm", reboot_safe=True)
            self.restore_file("/etc/pacman.conf")
            self.restore_file("/etc/pacman.d/mirrorlist")
            self.restore_file("/usr/share/libalpm/hooks/90-packagekit-refresh.hook")
            self.machine.execute("rm /etc/pacman.conf /etc/pacman.d/mirrorlist /var/lib/pacman/sync/* /usr/share/libalpm/hooks/90-packagekit-refresh.hook")
            self.machine.execute("test -d /var/lib/PackageKit/alpm && rm -r /var/lib/PackageKit/alpm || true")  # Drop alpm state directory as it interferes with running offline
            # Initial config for installation
            empty_repo_dir = '/var/lib/cockpittest/empty'
            config = f"""
[options]
Architecture = auto
HoldPkg     = pacman glibc

[empty]
SigLevel = Never
Server = file://{empty_repo_dir}
"""
            # HACK: Setup empty repo for packagekit
            self.machine.execute(f"mkdir -p {empty_repo_dir} || true")
            self.machine.execute(f"repo-add {empty_repo_dir}/empty.db.tar.gz")
            self.machine.write("/etc/pacman.conf", config)
            self.machine.execute("pacman -Sy")
        else:
            self.restore_dir("/etc/yum.repos.d", reboot_safe=True)
            self.restore_dir("/var/cache/dnf", reboot_safe=True)
            self.machine.execute("rm -rf /etc/yum.repos.d/* /var/cache/yum/* /var/cache/dnf/*")

        # have PackageKit start from a clean slate
        self.machine.execute("systemctl stop packagekit")
        self.machine.execute("systemctl kill --signal=SIGKILL packagekit || true; rm -rf /var/cache/PackageKit")
        self.machine.execute("systemctl reset-failed packagekit || true")
        self.restore_file("/var/lib/PackageKit/transactions.db")

        if self.image in ["debian-stable", "debian-testing"]:
            # PackageKit tries to resolve some DNS names, but our test VM is offline; temporarily disable the name server to fail quickly
            self.machine.execute("mv /etc/resolv.conf /etc/resolv.conf.test")
            self.addCleanup(self.machine.execute, "mv /etc/resolv.conf.test /etc/resolv.conf")

        # reset automatic updates
        if self.backend == 'dnf':
            self.machine.execute("systemctl disable --now dnf-automatic dnf-automatic-install "
                                 "dnf-automatic.service dnf-automatic-install.timer")
            self.machine.execute("rm -r /etc/systemd/system/dnf-automatic* && systemctl daemon-reload || true")

        self.updateInfo = {}

    #
    # Helper functions for creating packages/repository
    #

    def createPackage(self, name, version, release, install=False,
                      postinst=None, depends="", content=None, arch=None, provides=None, **updateinfo):
        '''Create a dummy package in repo_dir on self.machine

        If install is True, install the package. Otherwise, update the package
        index in repo_dir.
        '''
        if provides:
            provides = f"Provides: {provides}"
        else:
            provides = ""

        if self.backend == "apt":
            self.createDeb(name, version + '-' + release, depends, postinst, install, content, arch, provides)
        elif self.backend == "alpm":
            self.createPacmanPkg(name, version, release, depends, postinst, install, content, arch, provides)
        else:
            self.createRpm(name, version, release, depends, postinst, install, content, arch, provides)
        if updateinfo:
            self.updateInfo[(name, version, release)] = updateinfo

    def createDeb(self, name, version, depends, postinst, install, content, arch, provides):
        '''Create a dummy deb in repo_dir on self.machine

        If install is True, install the package. Otherwise, update the package
        index in repo_dir.
        '''
        m = self.machine

        if arch is None:
            arch = self.primary_arch
        deb = f"{self.repo_dir}/{name}_{version}_{arch}.deb"
        if postinst:
            postinstcode = "printf '#!/bin/sh\n{0}' > /tmp/b/DEBIAN/postinst; chmod 755 /tmp/b/DEBIAN/postinst".format(
                postinst)
        else:
            postinstcode = ''
        if content is not None:
            for path, data in content.items():
                dest = "/tmp/b/" + path
                m.execute(f"mkdir -p '{os.path.dirname(dest)}'")
                if isinstance(data, dict):
                    m.execute(f"cp '{data['path']}' '{dest}'")
                else:
                    m.write(dest, data)
        m.execute(f"mkdir -p {self.repo_dir}")
        m.write("/tmp/b/DEBIAN/control", textwrap.dedent(f"""
            Package: {name}
            Version: {version}
            Priority: optional
            Section: test
            Maintainer: foo
            Depends: {depends}
            Architecture: {arch}
            Description: dummy {name}
            {provides}
            """))

        cmd = f"""set -e
                  {postinstcode}
                  touch /tmp/b/stamp-{name}-{version}
                  dpkg -b /tmp/b {deb}
                  rm -r /tmp/b
              """
        if install:
            cmd += "dpkg -i " + deb
        m.execute(cmd)
        self.addCleanup(m.execute, f"dpkg -P --force-depends --force-remove-reinstreq {name} 2>/dev/null || true")

    def createRpm(self, name, version, release, requires, post, install, content, arch, provides):
        '''Create a dummy rpm in repo_dir on self.machine

        If install is True, install the package. Otherwise, update the package
        index in repo_dir.
        '''
        if post:
            postcode = '\n%%post\n' + post
        else:
            postcode = ''
        if requires:
            requires = f"Requires: {requires}\n"
        if arch is None:
            arch = self.primary_arch
        installcmds = f"touch $RPM_BUILD_ROOT/stamp-{name}-{version}-{release}\n"
        installedfiles = f"/stamp-{name}-{version}-{release}\n"
        if content is not None:
            for path, data in content.items():
                installcmds += f'mkdir -p $(dirname "$RPM_BUILD_ROOT/{path}")\n'
                if isinstance(data, dict):
                    installcmds += f"cp {data['path']} \"$RPM_BUILD_ROOT/{path}\""
                else:
                    installcmds += 'cat >"$RPM_BUILD_ROOT/{0}" <<\'EOF\'\n'.format(path) + data + '\nEOF\n'
                installedfiles += f"{path}\n"

        architecture = ""
        if arch == self.primary_arch:
            architecture = f"BuildArch: {self.primary_arch}"
        spec = """
Summary: dummy {0}
Name: {0}
Version: {1}
Release: {2}
License: BSD
{8}
{7}
{4}

%%install
{5}

%%description
Test package.

%%files
{6}

{3}
""".format(name, version, release, postcode, requires, installcmds, installedfiles, architecture, provides)
        self.machine.write("/tmp/spec", spec)
        cmd = """
rpmbuild --quiet -bb /tmp/spec
mkdir -p {0}
cp ~/rpmbuild/RPMS/{4}/*.rpm {0}
rm -rf ~/rpmbuild
"""
        if install:
            cmd += "rpm -i {0}/{1}-{2}-{3}.*.rpm"
        self.machine.execute(cmd.format(self.repo_dir, name, version, release, arch))
        self.addCleanup(self.machine.execute, f"rpm -e --nodeps {name} 2>/dev/null || true")

    def createPacmanPkg(self, name, version, release, requires, postinst, install, content, arch, provides):
        '''Create a dummy pacman package in repo_dir on self.machine

        If install is True, install the package. Otherwise, update the package
        index in repo_dir.
        '''

        if arch is None:
            arch = 'any'

        sources = ""
        installcmds = 'package() {\n'
        if content is not None:
            sources = "source=("
            files = 0
            for path, data in content.items():
                p = os.path.dirname(path)
                installcmds += f'mkdir -p $pkgdir{p}\n'
                if isinstance(data, dict):
                    dpath = data["path"]

                    file = os.path.basename(dpath)
                    sources += file
                    files += 1
                    # TODO: hardcoded /tmp
                    self.machine.execute(f'cp {data["path"]} /tmp/{file}')
                    installcmds += f'cp {file} $pkgdir{path}\n'
                else:
                    installcmds += f'cat >"$pkgdir{path}" <<\'EOF\'\n' + data + '\nEOF\n'

            sources += ")"

        # Always stamp a file
        installcmds += f"touch $pkgdir/stamp-{name}-{version}-{release}\n"
        installcmds += '}'

        pkgbuild = f"""
pkgname={name}
pkgver={version}
pkgdesc="dummy {name}"
pkgrel={release}
arch=({arch})
depends=({requires})
{sources}

{installcmds}
"""

        if postinst:
            postinstcode = f"""
post_install() {{
    {postinst}
}}

post_upgrade() {{
    post_install $*
}}
"""
            self.machine.write(f"/tmp/{name}.install", postinstcode)
            pkgbuild += f"\ninstall={name}.install\n"

        self.machine.write("/tmp/PKGBUILD", pkgbuild)

        cmd = """
        cd /tmp/
        su builder -c "makepkg --cleanbuild --clean --force --nodeps --skipinteg --noconfirm"
"""

        if install:
            cmd += f"pacman -U --overwrite '*' --noconfirm {name}-{version}-{release}-{arch}.pkg.tar.zst\n"

        cmd += f"mkdir -p {self.repo_dir}\n"
        cmd += f"mv *.pkg.tar.zst {self.repo_dir}\n"
        # Clean up packaging files
        cmd += "rm PKGBUILD\n"
        if postinst:
            cmd += f"rm /tmp/{name}.install"
        self.machine.execute(cmd)
        self.addCleanup(self.machine.execute, f"pacman -Rdd --noconfirm {name} 2>/dev/null || true")

    def createAptChangelogs(self):
        # apt metadata has no formal field for bugs/CVEs, they are parsed from the changelog
        for ((pkg, ver, rel), info) in self.updateInfo.items():
            changes = info.get("changes", "some changes")
            if info.get("bugs"):
                changes += f" (Closes: {', '.join([('#' + str(b)) for b in info['bugs']])})"
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
                refs += '      <reference href="https://bugs.example.com?bug={0}" id="{0}" title="Bug#{0} Description" type="bugzilla"/>\n'.format(
                    b)
            for c in info.get("cves", []):
                refs += '      <reference href="https://cve.mitre.org/cgi-bin/cvename.cgi?name={0}" id="{0}" title="{0}" type="cve"/>\n'.format(
                    c)
            if info.get("securitySeverity"):
                refs += '      <reference href="https://access.redhat.com/security/updates/classification/#{0}" id="" title="" type="other"/>\n'.format(info[
                                                                                                                                                        "securitySeverity"])
            for e in info.get("errata", []):
                refs += '      <reference href="https://access.redhat.com/errata/{0}" id="{0}" title="{0}" type="self"/>\n'.format(
                    e)

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
            self.machine.execute('''set -e; echo 'deb [trusted=yes] file://{0} /' > /etc/apt/sources.list.d/test.list
                                    cd {0}; apt-ftparchive packages . > Packages
                                    xz -c Packages > Packages.xz
                                    O=$(apt-ftparchive -o APT::FTPArchive::Release::Origin=cockpittest release .); echo "$O" > Release
                                    echo 'Changelogs: http://localhost:12345/changelogs/@CHANGEPATH@' >> Release
                                    '''.format(self.repo_dir))
            pid = self.machine.spawn(f"cd {self.repo_dir}; exec python3 -m http.server 12345", "changelog")
            # pid will not be present for rebooting tests
            self.addCleanup(self.machine.execute, "kill %i || true" % pid)
            self.machine.wait_for_cockpit_running(port=12345)  # wait for changelog HTTP server to start up
        elif self.backend == "alpm":
            self.machine.execute(f'''set -e;
                                     cd {self.repo_dir}
                                     repo-add {self.repo_dir}/testrepo.db.tar.gz *.pkg.tar.zst
                    ''')

            config = f"""
[testrepo]
SigLevel = Never
Server = file://{self.repo_dir}
            """
            if 'testrepo' not in self.machine.execute('grep testrepo /etc/pacman.conf || true'):
                self.machine.write("/etc/pacman.conf", config, append=True)

        else:
            self.machine.execute('''set -e; printf '[updates]\nname=cockpittest\nbaseurl=file://{0}\nenabled=1\ngpgcheck=0\n' > /etc/yum.repos.d/cockpittest.repo
                                    echo '{1}' > /tmp/updateinfo.xml
                                    createrepo_c {0}
                                    modifyrepo_c /tmp/updateinfo.xml {0}/repodata
                                    $(which dnf 2>/dev/null|| which yum) clean all'''.format(self.repo_dir, self.createYumUpdateInfo()))
