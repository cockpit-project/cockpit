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

import os
import sys
import subprocess
from common import testvm
from common import testinfra

def upload_scripts(machine, args):
    machine.execute("rm -rf /var/lib/testvm")
    machine.upload([ os.path.join(testinfra.TEST_DIR, "images", "scripts", "lib") ], "/var/lib/testvm")
    machine.upload([ os.path.join(testinfra.TEST_DIR, "images", "scripts", "%s.install" % machine.image) ], "/var/tmp")
    if args["containers"]:
        machine.upload([os.path.join(testinfra.TEST_DIR,"..", "containers")], "/var/tmp")

def run_install_script(machine, do_build, do_install, skip, arg, args):
    install = do_install
    if args["containers"]:
        do_install = False

    machine.execute("cd /var/tmp; ./%s.install%s%s%s%s%s%s" % (machine.image,
                                                         " --verbose" if args["verbose"] else "",
                                                         " --quick" if args["quick"] else "",
                                                         " --build" if do_build else "",
                                                         " --install" if do_install else "",
                                                         " --skip '%s'" % skip if skip else "",
                                                         " '%s'" % arg if arg else ""))
    if install and args["containers"]:
        machine.execute("/var/lib/testvm/containers.install")

def build_and_maybe_install(image, do_install=False, skip=None, args=None):
    """Build and maybe install Cockpit into a test image"""
    machine = testvm.VirtMachine(verbose=args["verbose"], image=image, label="install")
    source = subprocess.check_output([ os.path.join(testinfra.TEST_DIR, "..", "tools", "make-source") ]).strip()
    machine.start(maintain=do_install, memory_mb=4096, cpus=4)
    completed = False
    try:
        machine.wait_boot()
        upload_scripts(machine, args=args)
        machine.upload([ source ], "/var/tmp")
        run_install_script(machine, True, do_install, skip, os.path.basename(source), args)
        completed = True
    finally:
        if not completed and args["sit"]:
            sys.stderr.write("ADDRESS: {0}\n".format(machine.address))
            raw_input ("Press RET to continue... ")
        try:
            machine.download_dir("/var/tmp/build-results", "tmp/build-results")
        finally:
            machine.stop()

def only_install(image, skip=None, args=None):
    """Install Cockpit into a test image"""
    machine = testvm.VirtMachine(verbose=args["verbose"], image=image, label="install")
    machine.start(maintain=True)
    try:
        machine.wait_boot()
        upload_scripts(machine,args=args)
        machine.execute("rm -rf /var/tmp/build-results");
        machine.upload([ "tmp/build-results" ], "/var/tmp")
        run_install_script(machine, False, True, skip, None, args)
    finally:
        machine.stop()

def build_and_install(install_image, build_image, args):
    args.setdefault("verbose", False)
    args.setdefault("sit", False)
    args.setdefault("quick", False)
    args.setdefault("build_image", testinfra.DEFAULT_IMAGE)
    args.setdefault("build_only", False)
    args.setdefault("install_only", False)
    args.setdefault("containers", False)
    try:
        skip = "cockpit-ostree"
        if install_image and "fedora-atomic" in install_image:
            skip = None

        if build_image and build_image == install_image:
            build_and_maybe_install(build_image, do_install=True, skip=skip, args=args)
        else:
            if build_image:
                build_and_maybe_install(build_image, do_install=False, skip=skip, args=args)
            if install_image:
                only_install(install_image, skip, args=args)
    except testvm.Failure, ex:
        raise ("Unable to build and install cockpit package", ex)
    return True
