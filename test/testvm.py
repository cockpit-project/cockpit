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

import contextlib
import errno
import fcntl
import json
import libvirt
import libvirt_qemu
from   lxml import etree
from   operator import attrgetter
import os
import random
import re
import select
import string
import socket
import subprocess
import tempfile
import sys
import shutil
import threading
import time

DEFAULT_FLAVOR="cockpit"
DEFAULT_OS = "fedora-22"
DEFAULT_ARCH = "x86_64"

MEMORY_MB = 1024

SSH_WARNING = re.compile(r'Warning: Permanently added .* to the list of known hosts.*\n')

# based on http://stackoverflow.com/a/17753573
# we use this to quieten down calls
@contextlib.contextmanager
def stdchannel_redirected(stdchannel, dest_filename):
    """
    A context manager to temporarily redirect stdout or stderr
    e.g.:
    with stdchannel_redirected(sys.stderr, os.devnull):
        noisy_function()
    """
    try:
        oldstdchannel = os.dup(stdchannel.fileno())
        dest_file = open(dest_filename, 'w')
        os.dup2(dest_file.fileno(), stdchannel.fileno())
        yield
    finally:
        if oldstdchannel is not None:
            os.dup2(oldstdchannel, stdchannel.fileno())
        if dest_file is not None:
            dest_file.close()

class Failure(Exception):
    def __init__(self, msg):
        self.msg = msg
    def __str__(self):
        return self.msg

class RepeatThis(Failure):
    pass

class Machine:
    boot_hook = None

    def __init__(self, address=None, flavor=None, system=None, arch=None, verbose=False, label=None):
        self.verbose = verbose
        self.flavor = flavor or DEFAULT_FLAVOR

        conf_file = "guest/%s.conf" % self.flavor
        if os.path.exists(conf_file):
            with open(conf_file, "r") as f:
                self.conf = json.load(f)
        else:
            self.conf = { }

        self.os = system or self.getconf('os') or os.environ.get("TEST_OS") or DEFAULT_OS
        self.arch = arch or os.environ.get("TEST_ARCH") or DEFAULT_ARCH

        self.tag = "0"
        tags = self.getconf('tags')
        if tags and self.os in tags:
            self.tag = tags[self.os]

        self.image = "%s-%s-%s-%s" % (self.flavor, self.os, self.arch, self.tag)
        self.test_dir = os.path.abspath(os.path.dirname(__file__))
        self.test_data = os.environ.get("TEST_DATA") or self.test_dir
        self.vm_username = "root"
        self.vm_password = "foobar"
        self.address = address
        self.mac = None
        self.label = label or "UNKNOWN"

    def getconf(self, key):
        return key in self.conf and self.conf[key]

    def message(self, *args):
        """Prints args if in verbose mode"""
        if not self.verbose:
            return
        print " ".join(args)

    def start(self, maintain=False, macaddr=None):
        """Overridden by machine classes to start the machine"""
        self.message("Assuming machine is already running")

    def stop(self):
        """Overridden by machine classes to stop the machine"""
        self.message("Not shutting down already running machine")

    # wait for ssh port 22 to be open in the machine
    # get_new_address is an optional function to acquire a new ip address for each try
    #   it is expected to raise an exception on failure and return a valid address otherwise
    def wait_ssh(self, timeout_sec = 120, get_new_address = None):
        """Try to connect to self.address on port 22"""
        start_time = time.time()
        while (time.time() - start_time) < timeout_sec:
            if get_new_address:
                try:
                    self.address = get_new_address()
                except:
                    continue
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1)
            try:
                sock.connect((self.address, 22))
                return True
            except:
                pass
            finally:
                sock.close()
            time.sleep(0.5)
        return False

    def wait_user_login(self):
        """Wait until logging in as non-root works.

           Most tests run as the "admin" user, so we make sure that
           user sessions are allowed (and cockit-ws will let "admin"
           in) before declaring a test machine as "booted".
        """
        tries_left = 60
        while (tries_left > 0):
            try:
                self.execute("! test -f /run/nologin")
                return
            except:
                pass
            tries_left = tries_left - 1
            time.sleep(1)
        raise Failure("Timed out waiting for /run/nologin to disappear")

    def wait_boot(self):
        """Wait for a machine to boot and execute hooks

        This is usually overridden by derived classes.
        """
        if self.boot_hook:
            environ = os.environ.copy()
            environ["TEST_MACHINE"] = self.address
            subprocess.check_call([ "/bin/sh", "-c", arg_vm_start_hook ], env=environ)

    def wait_poweroff(self):
        """Overridden by machine classes to wait for a machine to stop"""
        assert False, "Cannot wait for a machine we didn't start"

    def kill(self):
        """Overridden by machine classes to unconditionally kill the running machine"""
        assert False, "Cannot kill a machine we didn't start"

    def shutdown(self):
        """Overridden by machine classes to gracefully shutdown the running machine"""
        assert False, "Cannot shutdown a machine we didn't start"

    def execute(self, command=None, script=None, input=None, environment={}, quiet=False):
        """Execute a shell command in the test machine and return its output.

        Either specify @command or @script

        Arguments:
            command: The string to execute by /bin/sh.
            script: A multi-line script to execute in /bin/sh
            input: Input to send to the command
            environment: Additional environmetn variables
        Returns:
            The command/script output as a string.
        """
        assert command or script
        assert self.address

        cmd = [
            "ssh",
            "-i", self._calc_identity(),
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-l", self.vm_username,
            self.address
        ]

        if command:
            assert not environment, "Not yet supported"
            cmd += [command]
            self.message("+", command)
        else:
            assert not input, "input not supported to script"
            cmd += ["sh", "-s"]
            if self.verbose:
                cmd += ["-x"]
            input = ""
            for name, value in environment.items():
                input += "%s='%s'\n" % (name, value)
            input += script
            command = "<script>"

        output = ""
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        stdin_fd = proc.stdin.fileno()
        stdout_fd = proc.stdout.fileno()
        stderr_fd = proc.stderr.fileno()
        rset = [stdout_fd, stderr_fd]
        wset = [stdin_fd]
        while len(rset) > 0 or len(wset) > 0:
            ret = select.select(rset, wset, [], 10)
            for fd in ret[0]:
                if fd == stdout_fd:
                    data = os.read(fd, 1024)
                    if data == "":
                        rset.remove(stdout_fd)
                        proc.stdout.close()
                    else:
                        if self.verbose:
                            sys.stdout.write(data)
                        output += data
                elif fd == stderr_fd:
                    data = os.read(fd, 1024)
                    if data == "":
                        rset.remove(stderr_fd)
                        proc.stderr.close()
                    else:
                        data = SSH_WARNING.sub("", data)
                        if not quiet or self.verbose:
                            sys.stderr.write(data)
            for fd in ret[1]:
                if fd == stdin_fd:
                    if input:
                        num = os.write(fd, input)
                        input = input[num:]
                    if not input:
                        wset.remove(stdin_fd)
                        proc.stdin.close()
        proc.wait()

        if proc.returncode != 0:
            raise subprocess.CalledProcessError(proc.returncode, command)
        return output

    def upload(self, sources, dest):
        """Upload a file into the test machine

        Arguments:
            sources: the array of paths of the file to upload
            dest: the file path in the machine to upload to
        """
        assert sources and dest
        assert self.address

        cmd = [
            "scp",
            "-i", self._calc_identity(),
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
        ] + sources + [ "%s@%s:%s" % (self.vm_username, self.address, dest), ]

        self.message("Uploading", " ,".join(sources))
        self.message(" ".join(cmd))
        if self.verbose:
            subprocess.check_call(cmd)
        else:
            with stdchannel_redirected(sys.stderr, os.devnull):
                subprocess.check_call(cmd)

    def download(self, source, dest):
        """Download a file from the test machine.
        """
        assert source and dest
        assert self.address

        cmd = [
            "scp",
            "-i", self._calc_identity(),
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "%s@%s:%s" % (self.vm_username, self.address, source), dest
        ]

        self.message("Downloading", source)
        self.message(" ".join(cmd))
        subprocess.check_call([ "rm", "-rf", dest ])
        subprocess.check_call(cmd)

    def download_dir(self, source, dest):
        """Download a directory from the test machine, recursively.
        """
        assert source and dest
        assert self.address

        cmd = [
            "scp",
            "-i", self._calc_identity(),
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-r",
            "%s@%s:%s" % (self.vm_username, self.address, source), dest
        ]

        self.message("Downloading", source)
        self.message(" ".join(cmd))
        try:
            subprocess.check_call([ "rm", "-rf", dest ])
            subprocess.check_call(cmd)
            subprocess.check_call([ "find", dest, "-type", "f", "-exec", "chmod", "0644", "{}", ";" ])
        except:
            self.message("Error while downloading journal")

    def write(self, dest, content):
        """Write a file into the test machine

        Arguments:
            content: Raw data to write to file
            dest: The file name in the machine to write to
        """
        assert dest
        assert self.address

        cmd = "cat > '%s'" % dest
        self.execute(command=cmd, input=content)

    def spawn(self, shell_cmd, log_id):
        """Spawn a process in the test machine.

        Arguments:
           shell_cmd: The string to execute by /bin/sh.
           log_id: The name of the file, realtive to /var/log on the test
              machine, that will receive stdout and stderr of the command.
        Returns:
            The pid of the /bin/sh process that executes the command.
        """
        return int(self.execute("{ (%s) >/var/log/%s 2>&1 & }; echo $!" % (shell_cmd, log_id)))

    def _calc_identity(self):
        identity = os.path.join(self.test_dir, "guest/identity")
        os.chmod(identity, 0600)
        return identity

    def journal_messages(self, syslog_ids, log_level):
        """Return interesting journal messages"""

        # Journald does not always set trusted fields like
        # _SYSTEMD_UNIT or _EXE correctly for the last few messages of
        # a dying process, so we filter by the untrusted but reliable
        # SYSLOG_IDENTIFIER instead

        matches = " ".join(map(lambda id: "SYSLOG_IDENTIFIER=" + id, syslog_ids))

        # Some versions of journalctl terminate unsuccessfully when
        # the output is empty.  We work around this by ignoring the
        # exit status and including error messages from journalctl
        # itself in the returned messages.

        cmd = "journalctl 2>&1 -o cat -p %d %s || true" % (log_level, matches)
        messages = self.execute(cmd).splitlines()
        if len(messages) == 1 and ("Cannot assign requested address" in messages[0]
                                   or "-- No entries --" in messages[0]):
            # No messages
            return [ ]
        else:
            return messages

    def audit_messages(self, type_pref):
        cmd = "journalctl -o cat SYSLOG_IDENTIFIER=kernel 2>&1 | grep 'type=%s.*audit' || true" % (type_pref, )
        messages = self.execute(cmd).splitlines()
        if len(messages) == 1 and "Cannot assign requested address" in messages[0]:
            messages = [ ]
        return messages

class VirtEventHandler():
    """ VirtEventHandler registers event handlers (currently: boot, resume, reboot) for libvirt domain instances
        It requires an existing libvirt connection handle, because libvirt requires the domain
        references to be from the same connection instance!
        A thread in the background will run the libvirt event loop. Convenience functions wait_for_reboot,
        wait_for_running and wait_for_stopped exist (with timeouts).
        Access to the datastructures is mutex-protected, with an additional threading.Condition object
        for signaling new events (to avoid polling in the wait* convenience functions).
        It is expected for the caller to register new domains and if possible deregister them for the callbacks.
    """
    def __init__(self, libvirt_connection, verbose = False):
        self.eventLoopThread = None
        self.domain_status = { }
        self.domain_has_rebooted = { }
        self.verbose = verbose
        self.connection = libvirt_connection

        # register event handlers
        self.registered_callbacks = { }

        self.data_lock = threading.RLock()
        self.signal_condition = threading.Condition(self.data_lock)

        self.virEventLoopNativeStart()

    # 'reboot' and domain lifecycle events are treated differently by libvirt
    # a regular reboot doesn't affect the started/stopped state of the domain
    @staticmethod
    def domain_event_reboot_callback(conn, dom, event_handler):
        key = (dom.name(), dom.ID())
        with event_handler.data_lock:
            if not key in event_handler.domain_has_rebooted or event_handler.domain_has_rebooted[key] != True:
                if event_handler.verbose:
                    sys.stderr.write("[%s] REBOOT: Domain '%s' (ID %s)\n" % (str(time.time()), dom.name(), dom.ID()))
                event_handler.domain_has_rebooted[key] = True
                event_handler.signal_condition.notifyAll()

    @staticmethod
    def domain_event_callback(conn, dom, event, detail, event_handler):
        key = (dom.name(), dom.ID())
        value = { 'status': event_handler.dom_event_to_string(event),
                  'detail': event_handler.dom_detail_to_string(event, detail)
                }
        with event_handler.data_lock:
            if not key in event_handler.domain_status or event_handler.domain_status[key] != value:
                event_handler.domain_status[key] = value
                event_handler.signal_condition.notifyAll()
                if event_handler.verbose:
                    sys.stderr.write("[%s] EVENT: Domain '%s' (ID %s) %s %s\n" % (
                            str(time.time()),
                            dom.name(),
                            dom.ID(),
                            event_handler.dom_event_to_string(event),
                            event_handler.dom_detail_to_string(event, detail))
                        )

    def register_handlers_for_domain(self):
        self.deregister_handlers_for_domain()
        self.registered_callbacks = [
                self.connection.domainEventRegisterAny(None,
                                                       libvirt.VIR_DOMAIN_EVENT_ID_LIFECYCLE,
                                                       VirtEventHandler.domain_event_callback,
                                                       self),
                self.connection.domainEventRegisterAny(None,
                                                       libvirt.VIR_DOMAIN_EVENT_ID_REBOOT,
                                                       VirtEventHandler.domain_event_reboot_callback,
                                                       self)
            ]

    def deregister_handlers_for_domain(self):
        for cb in self.registered_callbacks:
            self.connection.domainEventDeregisterAny(cb)
        self.registered_callbacks = [ ]

    # mapping of event and detail ids to strings from
    # http://libvirt.org/git/?p=libvirt-python.git;a=blob_plain;f=examples/event-test.py;hb=HEAD
    def dom_event_to_string(self, event):
        domEventStrings = ( "Defined",
                            "Undefined",
                            "Started",
                            "Suspended",
                            "Resumed",
                            "Stopped",
                            "Shutdown",
                            "PMSuspended",
                            "Crashed"
                          )
        return domEventStrings[event]

    def dom_detail_to_string(self, event, detail):
        domEventStrings = (
            ( "Added", "Updated" ),
            ( "Removed", ),
            ( "Booted", "Migrated", "Restored", "Snapshot", "Wakeup" ),
            ( "Paused", "Migrated", "IOError", "Watchdog", "Restored", "Snapshot", "API error" ),
            ( "Unpaused", "Migrated", "Snapshot" ),
            ( "Shutdown", "Destroyed", "Crashed", "Migrated", "Saved", "Failed", "Snapshot"),
            ( "Finished", ),
            ( "Memory", "Disk" ),
            ( "Panicked", ),
            )
        return domEventStrings[event][detail]

    def reset_domain_status(self, domain):
        with self.data_lock:
            key = (domain.name(), domain.ID())
            if key in self.domain_status:
                del self.domain_status[key]

    def reset_domain_reboot_status(self, domain):
        with self.data_lock:
            key = (domain.name(), domain.ID())
            if key in self.domain_has_rebooted:
                del self.domain_has_rebooted[key]

    # reboot flag should have probably been reset before this
    # returns whether domain has rebooted
    def wait_for_reboot(self, domain, timeout_sec=120):
        start_time = time.time()
        end_time = start_time + timeout_sec
        key = (domain.name(), domain.ID())
        with self.data_lock:
            if key in self.domain_has_rebooted:
                return True
        remaining_time = end_time - time.time()
        with self.signal_condition:
            while remaining_time > 0:
                # wait for a domain event or our timeout
                self.signal_condition.wait(remaining_time)
                if key in self.domain_has_rebooted:
                    return True
                remaining_time = end_time - time.time()
        return False

    def domain_is_running(self, domain):
        key = (domain.name(), domain.ID())
        with self.data_lock:
            return key in self.domain_status and self.domain_status[key]['status'] in ["Started", "Resumed"]

    def domain_is_stopped(self, domain):
        key = (domain.name(), domain.ID())
        with self.data_lock:
            return key in self.domain_status and self.domain_status[key] in [{'status': 'Shutdown', 'detail': 'Finished'},
                                                                             {'status': 'Stopped', 'detail': 'Shutdown'}
                                                                            ]

    def wait_for_running(self, domain, timeout_sec=120):
        start_time = time.time()
        end_time = start_time + timeout_sec
        if self.domain_is_running(domain):
            return True
        remaining_time = end_time - time.time()
        with self.signal_condition:
            while remaining_time > 0:
                # wait for a domain event or our timeout
                self.signal_condition.wait(remaining_time)
                if self.domain_is_running(domain):
                    return True
                remaining_time = end_time - time.time()
        return False

    def _domain_is_valid(self, uuid):
        try:
            with stdchannel_redirected(sys.stderr, os.devnull):
                return self.connection.lookupByUUID(uuid)
        except:
            return False

    def wait_for_stopped(self, domain, timeout_sec=120):
        start_time = time.time()
        end_time = start_time + timeout_sec
        uuid = domain.UUID()
        if self.domain_is_stopped(domain) or not self._domain_is_valid(uuid):
            return True
        remaining_time = end_time - time.time()
        with self.signal_condition:
            while remaining_time > 0:
                # wait for a domain event or our timeout
                self.signal_condition.wait(remaining_time)
                if self.domain_is_stopped(domain) or not self._domain_is_valid(uuid):
                    return True
                remaining_time = end_time - time.time()
        return False

    def virEventLoopNativeStart(self):
        def virEventLoopNativeRun():
            self.register_handlers_for_domain()
            try:
                while libvirt:
                    if libvirt.virEventRunDefaultImpl() < 0:
                        raise Failure("Error in libvirt event handler")
            except:
                raise Failure("error in libvirt event loop")

        self.eventLoopThread = threading.Thread(target=virEventLoopNativeRun,
                                           name="libvirtEventLoop")
        self.eventLoopThread.setDaemon(True)
        self.eventLoopThread.start()

class VirtMachine(Machine):
    def __init__(self, **args):
        Machine.__init__(self, **args)

        self.run_dir = os.path.join(self.test_dir, "run")

        self._image_image = os.path.join(self.run_dir, "%s.qcow2" % (self.image))
        self._image_additional_iso = os.path.join(self.run_dir, "%s.iso" % (self.image))

        self._images_dir = os.path.join(self.test_data, "images")
        self._image_original = os.path.join(self._images_dir, "%s.qcow2" % (self.image))
        self._iso_original = os.path.join(self._images_dir, "%s.iso" % (self.image))
        self._checksum_original = os.path.join(self._images_dir, "%s-checksum" % (self.image))

        self._fixed_mac_flavors = self._get_fixed_mac_flavors()
        self._network_description = etree.parse(open("./guest/network-cockpit.xml"))

        # it is ESSENTIAL to register the default implementation of the event loop before opening a connection
        # otherwise messages may be delayed or lost
        libvirt.virEventRegisterDefaultImpl()
        self.virt_connection = self._libvirt_connection(hypervisor = "qemu:///session")
        self.event_handler = VirtEventHandler(libvirt_connection=self.virt_connection, verbose=self.verbose)

        # network names are currently hardcoded into network-cockpit.xml
        self.network_name = self._read_network_name()
        self.system_connection = self._libvirt_connection(hypervisor = "qemu:///system", read_only = True)
        self.dhcp_net = self.system_connection.networkLookupByName(self.network_name)

        # we can't see the network itself as non-root, create it using vm-prep as root

        # Unique identifiers for hostnet config
        self._hostnet = 8

        # init variables needed for running a vm
        self._cleanup()

    def _libvirt_connection(self, hypervisor, read_only = False):
        tries_left = 5
        connection = None
        if read_only:
            open_function = libvirt.openReadOnly
        else:
            open_function = libvirt.open
        while not connection and (tries_left > 0):
            try:
                connection = open_function(hypervisor)
            except:
                # wait a bit
                time.sleep(1)
                pass
            tries_left -= 1
        if not connection:
            # try again, but if an error occurs, don't catch it
            connection = open_function(hypervisor)
        return connection

    def _read_network_name(self):
        tree = etree.parse(open("./guest/network-cockpit.xml"))
        for h in tree.iter("bridge"):
            return h.get("name")
        raise Failure("Couldn't find network name")

    def save(self):
        assert not self._domain
        if not os.path.exists(self._images_dir):
            os.makedirs(self._images_dir, 0750)
        if os.path.exists(self._image_image):
            files = [ ]
            # Copy image via convert, to make it sparse again
            files.append(self._image_image)
            subprocess.check_call([ "qemu-img", "convert", "-O", "qcow2", self._image_image, self._image_original ])
            # Copy additional ISO as well when it exists
            if os.path.exists(self._image_additional_iso):
                files.append(self._image_additional_iso)
                shutil.copy(self._image_additional_iso, self._images_dir)
            with open(self._checksum_original, "w") as f:
                subprocess.check_call([ "sha256sum" ] + map(os.path.basename, files),
                                      cwd=self._images_dir,
                                      stdout=f)
        else:
            raise Failure("Nothing to save.")

    def needs_build(self):
        return not os.path.exists(self._image_original)

    def _resource_lockfile_path(self, resource):
        resources = os.path.join(tempfile.gettempdir(), ".cockpit-test-resources")
        resource = resource.replace("/", "_")
        return os.path.join(resources, resource)

    def _lock_resource(self, resource, exclusive=True):
        resources = os.path.join(tempfile.gettempdir(), ".cockpit-test-resources")
        if not os.path.exists(resources):
            os.mkdir(resources, 0755)
        lockpath = self._resource_lockfile_path(resource)
        fd = os.open(lockpath, os.O_WRONLY | os.O_CREAT)
        try:
            flags = fcntl.LOCK_NB
            if exclusive:
                flags |= fcntl.LOCK_EX
            else:
                flags |= fcntl.LOCK_SH
            fcntl.flock(fd, flags)
        except IOError, ex:
            os.close(fd)
            return False
        else:
            self._locks.append({'fd': fd, 'path': lockpath})
            return True

    def _get_fixed_mac_flavors(self):
        flavors = []
        tree = etree.parse(open("./guest/network-cockpit.xml"))
        for h in tree.find(".//dhcp"):
            flavor = h.get("{urn:cockpit-project.org:cockpit}flavor")
            if flavor and not flavor in flavors:
                flavors = flavors + [ flavor ]
        return flavors

    def _choose_macaddr(self):
        # only return a mac address if we have defined some for this flavor in the network definition
        if self.flavor not in self._fixed_mac_flavors:
            return None
        macaddrs = []
        tree = etree.parse(open("./guest/network-cockpit.xml"))
        for h in tree.find(".//dhcp"):
            macaddr = h.get("mac")
            flavor = h.get("{urn:cockpit-project.org:cockpit}flavor")
            if flavor == self.flavor:
                macaddrs = [ macaddr ]
                break
            elif not flavor:
                macaddrs.append(macaddr)
        for macaddr in macaddrs:
            if macaddr and self._lock_resource(macaddr):
                return macaddr
        raise Failure("Couldn't find unused mac address for '%s'" % (self.flavor))

    def _start_qemu(self, maintain=False, macaddr=None, wait_for_ip=True):
        # make sure we have a clean slate
        self._cleanup()

        if not os.path.exists(self.run_dir):
            os.makedirs(self.run_dir, 0750)

        if not os.path.exists(self._image_image):
            self.message("create image from backing file")
            subprocess.check_call([ "qemu-img", "create", "-q",
                                    "-f", "qcow2",
                                    "-o", "backing_file=%s,backing_fmt=qcow2" % self._image_original,
                                    self._image_image ])

            if os.path.exists(self._iso_original) and not os.path.exists(self._image_additional_iso):
                shutil.copy(self._iso_original, self._image_additional_iso)

        image_to_use = self._image_image
        if maintain:
            if not self._lock_resource(self._image_image, exclusive=True):
                raise Failure("Already running this image: %s (lockfile: '%s')" % (self.image, self._resource_lockfile_path(self.image)))
        else:
            # create an additional qcow2 image with the original as a backing file
            (unused, self._transient_image) = tempfile.mkstemp(suffix='.qcow2', prefix="", dir=self.run_dir)
            subprocess.check_call([ "qemu-img", "create", "-q",
                                    "-f", "qcow2",
                                    "-o", "backing_file=%s" % self._image_image,
                                    self._transient_image ])
            image_to_use = self._transient_image
        if not macaddr:
            macaddr = self._choose_macaddr()

        # domain xml
        test_domain_desc_original = ""
        with open("./files/test_domain.xml", "r") as dom_desc:
            test_domain_desc_original = dom_desc.read()

        additional_devices = ""
        if os.path.exists(self._image_additional_iso):
            """ load an iso image if one exists with the same basename as the image
            """
            additional_devices = """
            <disk type='file' device='cdrom'>
                <source file='%(iso)s'/>
                <target dev='hdb' bus='ide'/>
                <readonly/>
            </disk>""" % {"iso": self._image_additional_iso}

        # add the virtual machine
        # keep trying while there are naming conflicts, but not forever
        dom_created = False
        dom = None
        tries_left = 10
        mac_desc = ""
        if macaddr:
            mac_desc = "<mac address='%(mac)s'/>" % {'mac': macaddr}
        while not dom_created:
            try:
                rand_extension = '-' + ''.join(random.choice(string.digits + string.ascii_lowercase) for i in range(4))
                test_domain_desc = test_domain_desc_original % {
                                                "name": self.image + rand_extension,
                                                "arch": self.arch,
                                                "memory_in_mib": MEMORY_MB,
                                                "drive": image_to_use,
                                                "disk_serial": "ROOT",
                                                "mac": mac_desc,
                                                "additional_devices": additional_devices,
                                              }
                dom = self.virt_connection.createXML(test_domain_desc, libvirt.VIR_DOMAIN_START_AUTODESTROY)
            except libvirt.libvirtError, le:
                # be ready to try again
                if 'already exists with uuid' in le.message and tries_left > 0:
                    self.message("domain exists, trying with different name")
                    tries_left = tries_left - 1
                    time.sleep(1)
                    continue
                else:
                    raise
            dom_created = True

        self._domain = dom

        macs = self._qemu_network_macs()
        if not macs:
            raise Failure("no mac addresses found for created machine")
        self.message("available mac addresses: %s" % (", ".join(macs)))
        self.macaddr = macs[0]
        if wait_for_ip:
            self.address = self._ip_from_mac(self.macaddr)

    # start virsh console
    def qemu_console(self, snapshot=False, macaddr=None):
        try:
            self._start_qemu(maintain=not snapshot, macaddr=macaddr, wait_for_ip=False)
            self.message("started machine %s with address %s" % (self._domain.name(), self.address))
            print "console, to quit use Ctrl+], Ctrl+5 (depending on locale)"
            proc = subprocess.Popen("virsh -c qemu:///session console %s" % self._domain.ID(), shell=True)
            proc.wait()
        except:
            raise
        finally:
            self._cleanup()

    def start(self, maintain=False, macaddr=None):
        try:
            self._start_qemu(maintain=maintain, macaddr=macaddr)
            if not self._domain.isActive():
                self._domain.start()
            self._maintaining = maintain
        except:
            self._cleanup()
            raise

    def _ip_from_mac(self, mac, timeout_sec = 300):
        # first see if we use a mac address defined in the network description
        for h in self._network_description.find(".//dhcp"):
            if h.get("mac") == mac:
                return h.get("ip")
        # we didn't find it in the network description, so get it from the dhcp lease information

        # our network is defined system wide, so we need a different hypervisor connection
        # if there are multiple matches for the mac, get the most current one
        start_time = time.time()
        while (time.time() - start_time) < timeout_sec:
            try:
                with stdchannel_redirected(sys.stderr, os.devnull):
                    applicable_leases = self.dhcp_net.DHCPLeases(mac)
            except:
                time.sleep(1)
                continue
            if applicable_leases:
                return sorted(applicable_leases, key=lambda lease: lease['expirytime'], reverse=True)[0]['ipaddr']
            time.sleep(1)

        macs = self._qemu_network_macs()
        lease_info = "\n".join(map(lambda lease: str(lease), self.dhcp_net.DHCPLeases()))
        raise Failure("Can't resolve IP of %s\nAll current addresses: [%s]\nAll leases: %s" % (mac, ", ".join(macs), lease_info))

    def reset_reboot_flag(self):
        self.event_handler.reset_domain_reboot_status(self._domain)

    def wait_reboot(self):
        if not self.event_handler.wait_for_reboot(self._domain):
            raise Failure("system didn't notify us about a reboot")
        # we may have to check for a new dhcp lease, but the old one can be active for a bit
        if not self.wait_ssh(timeout_sec = 60, get_new_address = lambda: self._ip_from_mac(self.macaddr, timeout_sec=5)):
            raise Failure("system didn't reboot properly")
        self.wait_user_login()

    def wait_boot(self, wait_for_running_timeout = 120):
        # we should check for selinux relabeling in progress here
        if not self.event_handler.wait_for_running(self._domain, timeout_sec=wait_for_running_timeout ):
            raise Failure("Machine %s didn't start." % (self.address))

        if not Machine.wait_ssh(self, get_new_address = lambda: self._ip_from_mac(self.macaddr, timeout_sec=5)):
            raise Failure("Unable to reach machine %s via ssh." % (self.address))
        self.wait_user_login()

    def stop(self, timeout_sec=120):
        if self._maintaining:
            self.shutdown(timeout_sec=timeout_sec)
        else:
            self.kill()

    def _cleanup(self, quick=False):
        try:
            if not quick:
                if hasattr(self, '_disks'):
                    for index in dict(self._disks):
                        self.rem_disk(index)
            self._disks = { }
            if hasattr(self, '_locks'):
                for lock_entry in self._locks:
                    # explicitly unlink the file so the resource becomes available again
                    os.unlink(lock_entry['path'])
                    os.close(lock_entry['fd'])
            self._locks = []
            self._domain = None
            self.address = None
            self.macaddr = None
            if hasattr(self, '_transient_image') and self._transient_image and os.path.exists(self._transient_image):
                os.unlink(self._transient_image)
        except:
            (type, value, traceback) = sys.exc_info()
            print >> sys.stderr, "WARNING: Cleanup failed:", str(value)

    def kill(self):
        # stop system immediately, with potential data loss
        # to shutdown gracefully, use shutdown()
        if hasattr(self, '_domain') and self._domain:
            if self._domain.isActive():
                self._domain.destroy()
        self._cleanup(quick=True)

    def wait_poweroff(self, timeout_sec=120):
        # shutdown must have already been triggered
        if self._domain:
            if not self.event_handler.wait_for_stopped(self._domain, timeout_sec=timeout_sec):
                self.message("waiting for machine poweroff timed out")

        self._cleanup()

    def shutdown(self, timeout_sec=120):
        # shutdown the system gracefully
        # to stop it immediately, use kill()
        try:
            if self._domain:
                self._domain.shutdown()
            self.wait_poweroff(timeout_sec=timeout_sec)
        finally:
            self._cleanup()

    def add_disk(self, size, serial=None):
        index = 1
        while index in self._disks:
            index += 1

        if not serial:
            serial = "DISK%d" % index

        path = os.path.join(self.run_dir, "disk-%s-%d" % (self.address, index))
        if os.path.exists(path):
            os.unlink(path)

        subprocess.check_call(["qemu-img", "create", "-q", "-f", "raw", path, str(size)])

        disk_desc_template = ""
        with open("./files/test_domain_disk.xml", "r") as desc_file:
            disk_desc_template = desc_file.read()
            filename = path

        dev = 'sd' + string.ascii_lowercase[index]
        disk_desc = disk_desc_template % {
                          'file': filename,
                          'serial': serial,
                          'unit': index,
                          'dev': dev
                        }

        if self._domain.attachDeviceFlags(disk_desc, libvirt.VIR_DOMAIN_AFFECT_LIVE) != 0:
            raise Failure("Unable to add disk to vm")

        self._disks[index] = {
            "path": path,
            "serial": serial,
            "filename": filename,
            "dev": dev
        }

        return index

    def set_disk_io_speed(self, disk_index, speed_in_bytes=0):
        subprocess.check_call([
              "virsh", "-c", "qemu:///session", "blkdeviotune", "--current", str(self._domain.ID()), self._disks[disk_index]["dev"],
              "--total-bytes-sec", str(speed_in_bytes)
            ])

    def add_disk_path(self, main_index):
        index = 1
        while index in self._disks:
            index += 1

        filename = self._disks[main_index]["path"]
        serial = self._disks[main_index]["serial"]

        dev = 'sd' + string.ascii_lowercase[index]
        disk_desc_template = ""
        with open("./files/test_domain_disk.xml", "r") as desc_file:
            disk_desc_template = desc_file.read()
        disk_desc = disk_desc_template % {'file': filename, 'serial': serial, 'unit': index, 'dev': dev}

        if self._domain.attachDeviceFlags(disk_desc, libvirt.VIR_DOMAIN_AFFECT_LIVE ) != 0:
            raise Failure("Unable to add disk to vm")

        self._disks[index] = {
            "filename": filename,
            "serial": serial,
            "dev": dev
        }

        return index

    def rem_disk(self, index):
        assert index in self._disks
        disk = self._disks.pop(index)

        disk_desc_template = ""
        with open("./files/test_domain_disk.xml", "r") as desc_file:
            disk_desc_template = desc_file.read()
        disk_desc = disk_desc_template % {
                      'file': disk["filename"],
                      'serial': disk["serial"],
                      'unit': index,
                      'dev': disk["dev"]
                    }
        if self._domain.detachDeviceFlags(disk_desc, libvirt.VIR_DOMAIN_AFFECT_LIVE ) != 0:
            raise Failure("Unable to remove disk from vm")

        # if this isn't just an additional path, clean up
        if "path" in disk and disk["path"] and os.path.exists(disk["path"]):
            os.unlink(disk["path"])

    def _qemu_monitor(self, command):
        self.message("& " + command)
        # you can run commands manually using virsh:
        # virsh -c qemu:///session qemu-monitor-command [domain name/id] --hmp [command]
        output = libvirt_qemu.qemuMonitorCommand(self._domain, command, libvirt_qemu.VIR_DOMAIN_QEMU_MONITOR_COMMAND_HMP)
        self.message(output.strip())
        return output

    def _qemu_network_macs(self):
        macs = []
        for line in self._qemu_monitor("info network").split("\n"):
            x, y, mac = line.partition("macaddr=")
            mac = mac.strip()
            if mac:
                macs.append(mac)
        return macs

    def add_netiface(self, mac=None, vlan=0):
        cmd = "device_add e1000"
        if mac:
            cmd += ",mac=%s" % mac
        macs = self._qemu_network_macs()
        if vlan == 0:
            # selinux can prevent the creation of the bridge
            # https://bugzilla.redhat.com/show_bug.cgi?id=1267217
            output = self._qemu_monitor("netdev_add bridge,id=hostnet%d,br=cockpit1" % self._hostnet)
            if "Device 'bridge' could not be initialized" in output:
                raise Failure("Unable to add bridge for virtual machine, possibly related to an selinux-denial")
            cmd += ",netdev=hostnet%d" % self._hostnet
            self._hostnet += 1
        else:
            cmd += ",vlan=%d" % vlan
        self._qemu_monitor(cmd)
        if mac:
            return mac
        for mac in self._qemu_network_macs():
            if mac not in macs:
                return mac
        raise Failure("Unable to find mac address of the new network adapter")

    def needs_writable_usr(self):
        # On atomic systems, we need a hack to change files in /usr/lib/systemd
        if "atomic" in self.os:
            self.execute(command="mount -o remount,rw /usr")
