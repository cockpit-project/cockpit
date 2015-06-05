#!/usr/bin/python
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

import subprocess
import os
import sys

class AtomicCockpitInstaller:
    root_home = "/root"
    packages_force_install = ["cockpit-test-assets"]
    #packages_force_install = [ ]

    def __init__(self, rpms=None, verbose=False):
        self.verbose = verbose
        self.rpms = rpms

    def files_in_package(self, rpm):
        """ list of files in an rpm, including path """
        cmd = "rpm2cpio %s | cpio --list --quiet" % (rpm)
        filelist = subprocess.check_output(cmd, shell=True).strip().split("\n")
        # filenames have leading . character
        return map(lambda fname: fname[1:], filelist)

    def package_basename(self, package):
        """ only accept package with the name 'cockpit-%s-*' and return 'cockpit-%s' or None"""
        basename = "-".join(package.split("-")[:2])
        if basename.startswith("cockpit-"):
            return basename
        else:
            return None

    def package_basenames(self, package_names):
        """ convert a list of package names to a list of their basenames """
        return filter(lambda s: not s is None, map(lambda s: self.package_basename(s), package_names))

    def extract_files(self, rpm, directory):
        """ extract an rpm into a target base directory """
        cmd = "rpm2cpio %s | cpio --make-directories --extract --quiet --unconditional" % (rpm)
        subprocess.check_call(cmd, cwd=directory, shell=True)

    def extract_archives(self, packages_to_install, directory):
        """ unpack a list of rpms into a given directory
            return list of extracted files """
        files_extracted = []
        for rpm in packages_to_install:
            if not os.path.isabs(rpm):
                rpm = os.path.abspath(os.path.join(os.getcwd(), rpm))
            if self.verbose:
                print "processing package %s" % (rpm)
            files_extracted.extend(self.files_in_package(rpm))
            self.extract_files(rpm, directory)
        return files_extracted

    def get_cockpit_packages(self):
        """ get list installed cockpit packages """
        installed_packages = []
        with open(os.path.join(self.root_home, "cockpit_packages"), "r") as package_file:
            installed_packages = package_file.read().strip().split("\n")
        return self.package_basenames(installed_packages)

    def get_current_cockpit_files(self):
        """ get current list of installed cockpit files
            this list is created during initial setup and updated during during each install """
        installed_files = []
        with open(os.path.join(self.root_home, "cockpit_files"), "r") as f:
            installed_files = f.read().strip().split("\n")
        return installed_files

    def remove_orphaned_cockpit_files(self, installed_files):
        """ delete any cockpit files that aren't included in the new packages, ignore directories """
        current_files = filter(lambda f: os.path.exists(f), self.get_current_cockpit_files())
        files_to_delete = filter(lambda f: f not in installed_files and not os.path.isdir(f), current_files)
        for f in files_to_delete:
            if self.verbose:
                print "delete %s on atomic system" % (f)
            os.remove(f)

    def run(self):
        installed_packages = self.get_cockpit_packages()
        for p in self.packages_force_install:
            if not p in installed_packages:
                if self.verbose:
                    print "adding package %s (forced)" % (p)
                installed_packages.append(p)

        packages_to_install = filter(lambda p: any(os.path.split(p)[1].startswith(base) for base in installed_packages), self.rpms)

        if self.verbose:
            print "packages to install:"
            print packages_to_install

        installed_files = self.extract_archives(packages_to_install, "/")

        self.remove_orphaned_cockpit_files(installed_files)

        # save new list of installed files
        with open(os.path.join(self.root_home, "cockpit_files"), "w") as f:
            f.write("\n".join(installed_files))

rpms = os.getenv("TEST_PACKAGES").split(" ")
verbose = os.getenv("TEST_VERBOSE", False)

try:
    cockpit_installer = AtomicCockpitInstaller(rpms=rpms, verbose=verbose)
    cockpit_installer.run()
except Exception, ex:
    print >> sys.stderr, "Atomic cockpit installation failed:", ex
    sys.exit(1)
