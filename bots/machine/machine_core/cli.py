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

import signal
import argparse
from . import machine_virtual

def cmd_cli():
    parser = argparse.ArgumentParser(description="Run a VM image until SIGTERM or SIGINT")
    parser.add_argument("--memory", type=int, default=1024,
                        help="Memory in MiB to allocate to the VM (default: %(default)s)")
    parser.add_argument("image", help="Image name")
    args = parser.parse_args()

    network = machine_virtual.VirtNetwork(0)
    machine = machine_virtual.VirtMachine(image=args.image, networking=network.host(), memory_mb=args.memory)
    machine.start()
    machine.wait_boot()

    # run a command to force starting the SSH master
    machine.execute('uptime')

    # print ssh command
    print("ssh -o ControlPath=%s -p %s %s@%s" %
          (machine.ssh_master, machine.ssh_port, machine.ssh_user, machine.ssh_address))
    # print Cockpit web address
    print("http://%s:%s" % (machine.web_address, machine.web_port))
    # print marker that the VM is ready; tests can poll for this to wait for the VM
    print("RUNNING")

    signal.signal(signal.SIGTERM, lambda sig, frame: machine.stop())
    try:
        signal.pause()
    except KeyboardInterrupt:
        machine.stop()
