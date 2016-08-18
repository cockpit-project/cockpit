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
import os
import random
import re
import select
import signal
import string
import socket
import subprocess
import tempfile
import sys
import shutil
import threading
import time

import testinfra
import vmimages

import xml.etree.ElementTree as etree

DEFAULT_FLAVOR="cockpit"

MEMORY_MB = 1024

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
        stdchannel.flush()
        oldstdchannel = os.dup(stdchannel.fileno())
        dest_file = open(dest_filename, 'w')
        os.dup2(dest_file.fileno(), stdchannel.fileno())
        yield
    finally:
        if oldstdchannel is not None:
            os.dup2(oldstdchannel, stdchannel.fileno())
        if dest_file is not None:
            dest_file.close()

class Timeout:
    """ Add a timeout to an operation
        Specify machine to ensure that a machine's ssh operations are canceled when the timer expires.
    """
    def __init__(self, seconds=1, error_message='Timeout', machine=None):
        self.seconds = seconds
        self.error_message = error_message
        self.machine = machine
    def handle_timeout(self, signum, frame):
        if self.machine:
            if self.machine.ssh_process:
                self.machine.ssh_process.terminate()
            self.machine.disconnect()

        raise Exception(self.error_message)
    def __enter__(self):
        signal.signal(signal.SIGALRM, self.handle_timeout)
        signal.alarm(self.seconds)
    def __exit__(self, type, value, traceback):
        signal.alarm(0)

class Failure(Exception):
    def __init__(self, msg):
        self.msg = msg
    def __str__(self):
        return self.msg

class RepeatableFailure(Failure):
    pass

class Machine:
    def __init__(self, address=None, image=None, verbose=False, label=None, fetch=True):
        self.verbose = verbose

        # Currently all images are x86_64. When that changes we will have
        # an override file for those images that are not
        self.arch = "x86_64"

        self.image = image or testinfra.DEFAULT_IMAGE
        self.fetch = fetch
        self.vm_username = "root"
        self.address = address
        self.label = label or "UNKNOWN"
        self.ssh_master = None
        self.ssh_process = None
        self.ssh_port = 22

    def disconnect(self):
        self._kill_ssh_master()

    def message(self, *args):
        """Prints args if in verbose mode"""
        if not self.verbose:
            return
        print " ".join(args)

    def start(self, maintain=False, macaddr=None, memory_mb=None, cpus=None, wait_for_ip=True):
        """Overridden by machine classes to start the machine"""
        self.message("Assuming machine is already running")

    def stop(self):
        """Overridden by machine classes to stop the machine"""
        self.message("Not shutting down already running machine")

    # wait until we can execute something on the machine. ie: wait for ssh
    # get_new_address is an optional function to acquire a new ip address for each try
    #   it is expected to raise an exception on failure and return a valid address otherwise
    def wait_execute(self, timeout_sec=120, get_new_address=None):
        """Try to connect to self.address on ssh port"""

        # If connected to machine, kill master connection
        self._kill_ssh_master()

        start_time = time.time()
        while (time.time() - start_time) < timeout_sec:
            if get_new_address:
                try:
                    self.address = get_new_address()
                except:
                    continue
            addrinfo = socket.getaddrinfo(self.address, self.ssh_port, 0, socket.SOCK_STREAM)
            (family, socktype, proto, canonname, sockaddr) = addrinfo[0]
            sock = socket.socket(family, socktype, proto)
            sock.settimeout(1)
            try:
                sock.connect(sockaddr)
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
            except subprocess.CalledProcessError:
                pass
            tries_left = tries_left - 1
            time.sleep(1)
        raise Failure("Timed out waiting for /run/nologin to disappear")

    def wait_boot(self):
        """Wait for a machine to boot"""
        assert False, "Cannot wait for a machine we didn't start"

    def wait_poweroff(self):
        """Overridden by machine classes to wait for a machine to stop"""
        assert False, "Cannot wait for a machine we didn't start"

    def kill(self):
        """Overridden by machine classes to unconditionally kill the running machine"""
        assert False, "Cannot kill a machine we didn't start"

    def shutdown(self):
        """Overridden by machine classes to gracefully shutdown the running machine"""
        assert False, "Cannot shutdown a machine we didn't start"

    def _start_ssh_master(self):
        self._kill_ssh_master()

        control = os.path.join(testinfra.TEST_DIR, "tmp", "ssh-%h-%p-%r-" + str(os.getpid()))

        # unix domain socket names aren't allowed to be too long
        # Since python doesn't expose the max allowed value as a constant
        # we hard code 108 as a magic number, based on the default
        # MAX_UNIX_FILE value on most linux systems.
        if len(control) > 108:
            control = os.path.join(tempfile.tempdir, "ssh-%h-%p-%r-" + str(os.getpid()))

        cmd = [
            "ssh",
            "-p", str(self.ssh_port),
            "-i", self._calc_identity(),
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "BatchMode=yes",
            "-M", # ControlMaster, no stdin
            "-o", "ControlPath=" + control,
            "-o", "LogLevel=ERROR",
            "-l", self.vm_username,
            self.address,
            "/bin/bash -c 'echo READY; read a'"
        ]

        # Connection might be refused, so try this 10 times
        tries_left = 10;
        while tries_left > 0:
            tries_left = tries_left - 1
            proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
            stdout_fd = proc.stdout.fileno()
            output = ""
            while stdout_fd > -1 and "READY" not in output:
                ret = select.select([stdout_fd], [], [], 10)
                for fd in ret[0]:
                    if fd == stdout_fd:
                        data = os.read(fd, 1024)
                        if data == "":
                            stdout_fd = -1
                            proc.stdout.close()
                        output += data

            if stdout_fd > -1:
                break

            # try again if the connection was refused, unless we've used up our tries
            proc.wait()
            if proc.returncode == 255 and tries_left > 0:
                self.message("ssh: connection refused, trying again")
                time.sleep(1)
                continue
            else:
                raise Failure("SSH master process exited with code: {0}".format(proc.returncode))

        self.ssh_master = control
        self.ssh_process = proc

        if not self._check_ssh_master():
            raise Failure("Couldn't launch an SSH master process")

    def _kill_ssh_master(self):
        if self.ssh_master:
            try:
                os.unlink(self.ssh_master)
            except OSError as e:
                if e.errno != errno.ENOENT:
                    raise
            self.ssh_master = None
        if self.ssh_process:
            self.ssh_process.stdin.close()
            self.ssh_process.wait()
            self.ssh_process = None

    def _check_ssh_master(self):
        if not self.ssh_master:
            return False
        cmd = [
            "ssh",
            "-q",
            "-p", str(self.ssh_port),
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "BatchMode=yes",
            "-S", self.ssh_master,
            "-O", "check",
            "-l", self.vm_username,
            self.address
        ]
        with open(os.devnull, 'w') as devnull:
            code = subprocess.call(cmd, stdin=devnull, stdout=devnull, stderr=devnull)
            if code == 0:
                return True
        return False

    def _ensure_ssh_master(self):
        if not self._check_ssh_master():
            self._start_ssh_master()

    def debug_shell(self):
        """Run an interactive shell"""
        cmd = [
            "ssh",
            "-p", str(self.ssh_port),
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-i", self._calc_identity(),
            "-l", self.vm_username,
            self.address
        ]
        subprocess.call(cmd)

    def execute(self, command=None, script=None, input=None, environment={}, stdout=None, quiet=False, direct=False):
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

        if not direct:
            self._ensure_ssh_master()

        cmd = [
            "ssh",
            "-p", str(self.ssh_port),
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "BatchMode=yes"
        ]

        if direct:
            cmd += [ "-i", self._calc_identity() ]
        else:
            cmd += [ "-o", "ControlPath=" + self.ssh_master ]

        cmd += [
            "-l", self.vm_username,
            self.address
        ]

        if command:
            assert not environment, "Not yet supported"
            if isinstance(command, basestring):
                cmd += [command]
                if not quiet:
                    self.message("+", command)
            else:
                cmd += command
                if not quiet:
                    self.message("+", *command)
        else:
            assert not input, "input not supported to script"
            cmd += ["sh", "-s"]
            if self.verbose:
                cmd += ["-x"]
            input = ""
            for name, value in environment.items():
                input += "%s='%s'\n" % (name, value)
                input += "export %s\n" % name
            input += script
            command = "<script>"

        if stdout:
            subprocess.call(cmd, stdout=stdout)
            return

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
                    elif not quiet or self.verbose:
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
            raise subprocess.CalledProcessError(proc.returncode, command, output=output)
        return output

    def upload(self, sources, dest):
        """Upload a file into the test machine

        Arguments:
            sources: the array of paths of the file to upload
            dest: the file path in the machine to upload to
        """
        assert sources and dest
        assert self.address

        self._ensure_ssh_master()

        cmd = [
            "scp", "-B",
            "-r", "-p",
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "ControlPath=" + self.ssh_master,
            "-o", "BatchMode=yes",
          ]
        if not self.verbose:
            cmd += [ "-q" ]

        def relative_to_test_dir(path):
            return os.path.join(testinfra.TEST_DIR, path)
        cmd += map(relative_to_test_dir, sources)

        cmd += [ "%s@[%s]:%s" % (self.vm_username, self.address, dest) ]

        self.message("Uploading", ", ".join(sources))
        self.message(" ".join(cmd))
        subprocess.check_call(cmd)

    def download(self, source, dest):
        """Download a file from the test machine.
        """
        assert source and dest
        assert self.address

        self._ensure_ssh_master()
        dest = os.path.join(testinfra.TEST_DIR, dest)

        cmd = [
            "scp", "-B",
            "-P", str(self.ssh_port),
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "ControlPath=" + self.ssh_master,
            "-o", "BatchMode=yes",
            ]
        if not self.verbose:
            cmd += ["-q"]
        cmd += [ "%s@[%s]:%s" % (self.vm_username, self.address, source), dest ]

        self.message("Downloading", source)
        self.message(" ".join(cmd))
        subprocess.check_call(cmd)

    def download_dir(self, source, dest):
        """Download a directory from the test machine, recursively.
        """
        assert source and dest
        assert self.address

        self._ensure_ssh_master()
        dest = os.path.join(testinfra.TEST_DIR, dest)

        cmd = [
            "scp", "-B",
            "-P", str(self.ssh_port),
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "ControlPath=" + self.ssh_master,
            "-o", "BatchMode=yes",
            "-r",
          ]
        if not self.verbose:
            cmd += ["-q"]
        cmd += [ "%s@[%s]:%s" % (self.vm_username, self.address, source), dest ]

        self.message("Downloading", source)
        self.message(" ".join(cmd))
        try:
            subprocess.check_call(cmd)
            subprocess.check_call([ "find", dest, "-type", "f", "-exec", "chmod", "0644", "{}", ";" ])
        except:
            self.message("Error while downloading directory '{0}'".format(source))

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
        identity = os.path.join(testinfra.TEST_DIR, "common/identity")
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

    def get_admin_group(self):
        if "debian" in self.image or "ubuntu" in self.image:
            return "sudo"
        else:
            return "wheel"

    def start_cockpit(self, atomic_wait_for_host="localhost", tls=False):
        """Start Cockpit.

        Cockpit is not running when the test virtual machine starts up, to
        allow you to make modifications before it starts.
        """

        if "atomic" in self.image:
            # HACK: https://bugzilla.redhat.com/show_bug.cgi?id=1228776
            # we want to run:
            # self.execute("atomic run cockpit/ws --no-tls")
            # but atomic doesn't forward the parameter, so we use the resulting command
            # also we need to wait for cockpit to be up and running
            cmd = """#!/bin/sh
            systemctl start docker &&
            """
            if tls:
                cmd += "/usr/bin/docker run -d --privileged --pid=host -v /:/host cockpit/ws /container/atomic-run --local-ssh\n"
            else:
                cmd += "/usr/bin/docker run -d --privileged --pid=host -v /:/host cockpit/ws /container/atomic-run --local-ssh --no-tls\n"
            with Timeout(seconds=90, error_message="Timeout while waiting for cockpit/ws to start"):
                self.execute(script=cmd)
            if atomic_wait_for_host:
                self.wait_for_cockpit_running(atomic_wait_for_host)
        elif tls:
            self.execute(script="""#!/bin/sh
            rm -f /etc/systemd/system/cockpit.service.d/notls.conf &&
            systemctl daemon-reload &&
            systemctl start cockpit.socket
            """)
        else:
            self.execute(script="""#!/bin/sh
            mkdir -p /etc/systemd/system/cockpit.service.d/ &&
            rm -f /etc/systemd/system/cockpit.service.d/notls.conf &&
            systemctl daemon-reload &&
            printf \"[Service]\nExecStartPre=-/bin/sh -c 'echo 0 > /proc/sys/kernel/yama/ptrace_scope'\nExecStart=\n%s --no-tls\n\" `systemctl cat cockpit.service | grep ExecStart=` > /etc/systemd/system/cockpit.service.d/notls.conf &&
            systemctl daemon-reload &&
            systemctl start cockpit.socket
            """)

    def restart_cockpit(self):
        """Restart Cockpit.
        """
        if "atomic" in self.image:
            with Timeout(seconds=90, error_message="Timeout while waiting for cockpit/ws to restart"):
                self.execute("docker restart `docker ps | grep cockpit/ws | awk '{print $1;}'`")
            self.wait_for_cockpit_running()
        else:
            self.execute("systemctl restart cockpit")

    def stop_cockpit(self):
        """Stop Cockpit.
        """
        if "atomic" in self.image:
            with Timeout(seconds=60, error_message="Timeout while waiting for cockpit/ws to stop"):
                self.execute("docker kill `docker ps | grep cockpit/ws | awk '{print $1;}'`")
        else:
            self.execute("systemctl stop cockpit.socket")

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

        # only show debug messages for specific domains, since
        # we might have multiple event handlers at any given time
        self.debug_domains = []

        self.virEventLoopNativeStart()

    def allow_domain_debug_output(self, dom_name):
        with self.data_lock:
            if not dom_name in self.debug_domains:
                self.debug_domains.append(dom_name)

    def forbid_domain_debug_output(self, dom_name):
        with self.data_lock:
            if dom_name in self.debug_domains:
                self.debug_domains.remove(dom_name)

    # 'reboot' and domain lifecycle events are treated differently by libvirt
    # a regular reboot doesn't affect the started/stopped state of the domain
    @staticmethod
    def domain_event_reboot_callback(conn, dom, event_handler):
        key = (dom.name(), dom.ID())
        with event_handler.data_lock:
            if not key in event_handler.domain_has_rebooted or event_handler.domain_has_rebooted[key] != True:
                if event_handler.verbose and dom.name() in event_handler.debug_domains:
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
                if event_handler.verbose and dom.name() in event_handler.debug_domains:
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

    def has_rebooted(self, domain):
        key = (domain.name(), domain.ID())
        with self.data_lock:
            return key in self.domain_has_rebooted

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
    memory_mb = None
    cpus = None

    def __init__(self, **args):
        Machine.__init__(self, **args)

        self.run_dir = os.path.join(testinfra.TEST_DIR, "tmp", "run")

        self.image_base = os.path.join(testinfra.TEST_DIR, "images", self.image)
        self.image_file = os.path.join(self.run_dir, "%s.qcow2" % (self.image))

        self._network_description = etree.parse(open(os.path.join(testinfra.TEST_DIR, "common", "network-cockpit.xml")))

        self.test_disk_desc_original = None

        # it is ESSENTIAL to register the default implementation of the event loop before opening a connection
        # otherwise messages may be delayed or lost
        libvirt.virEventRegisterDefaultImpl()
        self.virt_connection = self._libvirt_connection(hypervisor = "qemu:///session")
        self.event_handler = VirtEventHandler(libvirt_connection=self.virt_connection, verbose=self.verbose)

        # network names are currently hardcoded into network-cockpit.xml
        self.network_name = self._read_network_name()

        # we can't see the network itself as non-root, create it using vm-prep as root

        # Unique identifiers for hostnet config
        self._hostnet = 8

        self._domain = None

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
        for h in self._network_description.iter("bridge"):
            return h.get("name")
        raise Failure("Couldn't find network name")

    # only read the disk template once per machine
    def _domain_disk_template(self):
        if not self.test_disk_desc_original:
            with open(os.path.join(testinfra.TEST_DIR, "common/test-domain-disk.xml"), "r") as desc_file:
                self.test_disk_desc_original = desc_file.read()
        return self.test_disk_desc_original

    def _resource_lockfile_path(self, resource):
        resources = os.path.join(tempfile.gettempdir(), ".cockpit-test-resources")
        resource = resource.replace("/", "_")
        return os.path.join(resources, resource)

    # The lock is open until the process calling this function exits
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
            return True

    def _choose_macaddr(self):
        mac = None

        # Check if this has a forced mac address
        for h in self._network_description.find(".//dhcp"):
            image = h.get("{urn:cockpit-project.org:cockpit}image")
            if image == self.image:
                mac = h.get("mac")
                if mac:
                    return mac

        # Now try to lock that address
        pid = os.getpid()
        for seed in range(1, 64 * 1024):
            if not mac:
                mac = "9E%02x%02x%02x%04x" % ((pid >> 16) & 0xff, (pid >> 8) & 0xff, pid & 0xff, seed)
                mac = ":".join([mac[i:i+2] for i in range(0, len(mac), 2)])
            if self._lock_resource(mac):
                return mac
            mac = None

        raise Failure("Couldn't find unused mac address for '%s'" % (self.image))

    def _start_qemu(self, maintain=False, macaddr=None, wait_for_ip=True, memory_mb=None, cpus=None):
        memory_mb = memory_mb or VirtMachine.memory_mb or MEMORY_MB;
        cpus = cpus or VirtMachine.cpus or 1

        # make sure we have a clean slate
        self._cleanup()

        if not os.path.exists(self.run_dir):
            os.makedirs(self.run_dir, 0750)

        image_to_use = self.image_file
        if not os.path.exists(self.image_file):
            if maintain:
                # never write back to the original image
                self.message("create image from backing file")
                subprocess.check_call([ "qemu-img", "create", "-q",
                                        "-f", "qcow2",
                                        "-o", "backing_file=%s,backing_fmt=qcow2" % self.image_base,
                                        self.image_file ])
            else:
                # we don't have a "local" override image and we're throwing away the changes anyway
                image_to_use = self.image_base

        if not maintain:
            # create an additional qcow2 image with the original as a backing file
            (unused, self._transient_image) = tempfile.mkstemp(suffix='.qcow2', prefix="", dir=self.run_dir)
            subprocess.check_call([ "qemu-img", "create", "-q",
                                    "-f", "qcow2",
                                    "-o", "backing_file=%s" % image_to_use,
                                    self._transient_image ])
            image_to_use = self._transient_image
        if not macaddr:
            macaddr = self._choose_macaddr()

        # if we have a static ip, this implies a singleton instance
        # make sure we don't randomize the libvirt domain name in those cases
        static_domain_name = None
        if macaddr:
            lease = self._static_lease_from_mac(macaddr)
            if lease:
                static_domain_name = self.image + "_" + lease['name']

        # domain xml
        test_domain_desc_original = ""
        with open(os.path.join(testinfra.TEST_DIR, "common/test-domain.xml"), "r") as dom_desc:
            test_domain_desc_original = dom_desc.read()

        # add the virtual machine
        dom = None
        mac_desc = ""
        if macaddr:
            mac_desc = "<mac address='%(mac)s'/>" % {'mac': macaddr}
        try:
            if static_domain_name:
                domain_name = static_domain_name
            else:
                rand_extension = '-' + ''.join(random.choice(string.digits + string.ascii_lowercase) for i in range(4))
                domain_name = self.image + rand_extension
            test_domain_desc = test_domain_desc_original % {
                                            "name": domain_name,
                                            "arch": self.arch,
                                            "cpus": cpus,
                                            "memory_in_mib": memory_mb,
                                            "drive": image_to_use,
                                            "disk_serial": "ROOT",
                                            "mac": mac_desc,
                                            "iso": os.path.join(testinfra.TEST_DIR, "common/cloud-init.iso")
                                          }
            # allow debug output for this domain
            self.event_handler.allow_domain_debug_output(domain_name)
            dom = self.virt_connection.createXML(test_domain_desc, libvirt.VIR_DOMAIN_START_AUTODESTROY)
        except libvirt.libvirtError, le:
            # remove the debug output
            self.event_handler.forbid_domain_debug_output(domain_name)
            if not static_domain_name and 'already exists with uuid' in le.message:
                raise RepeatableFailure("libvirt domain already exists: " + le.message)
            else:
                raise

        self._domain = dom

        macs = self._qemu_network_macs()
        if not macs:
            raise Failure("no mac addresses found for created machine")
        self.message("available mac addresses: %s" % (", ".join(macs)))
        self.macaddr = macs[0]
        if wait_for_ip:
            self.address = self._ip_from_mac(self.macaddr)

    # start virsh console
    def qemu_console(self, maintain=True, macaddr=None, memory_mb=None, cpus=None):
        try:
            self._start_qemu(maintain=maintain, macaddr=macaddr, wait_for_ip=False, memory_mb=memory_mb, cpus=cpus)
            self.message("started machine %s with address %s" % (self._domain.name(), self.address))
            if maintain:
                self.message("Changes are written to the image file.")
                self.message("WARNING: Uncontrolled shutdown can lead to a corrupted image.")
            else:
                self.message("All changes are discarded, the image file won't be changed.")
            print "console, to quit use Ctrl+], Ctrl+5 (depending on locale)"
            proc = subprocess.Popen("virsh -c qemu:///session console %s" % self._domain.ID(), shell=True)
            proc.wait()
            try:
                if maintain:
                    self.shutdown()
                else:
                    self.kill()
            except libvirt.libvirtError, le:
                # the domain may have already been freed (shutdown) while the console was running
                self.message("libvirt error during shutdown: %s" % (le.get_error_message()))

        except:
            raise
        finally:
            self._cleanup()

    def start(self, maintain=False, macaddr=None, memory_mb=None, cpus=None, wait_for_ip=True):
        if self.fetch:
            vmimages.download_images([self.image], False, [])

        tries = 0
        while True:
            try:
                self._start_qemu(maintain=maintain, macaddr=macaddr, wait_for_ip=wait_for_ip, memory_mb=memory_mb, cpus=cpus)
                if not self._domain.isActive():
                    self._domain.start()
                self._maintaining = maintain
            except RepeatableFailure, ex:
                self.kill()
                if tries < 5:
                    tries += 1
                    time.sleep(2)
                    continue
                else:
                    raise
            except:
                self.kill()
                raise

            # Normally only one pass
            break

    def _static_lease_from_mac(self, mac):
        for h in self._network_description.find(".//dhcp"):
            netmac = h.get("mac") or ""
            if netmac.lower() == mac.lower():
                return { "ip":   h.get("ip"), "name": h.get("name") }
        return None

    def _diagnose_no_address(self):
        SCRIPT = """
            spawn virsh -c qemu:///session console $argv
            set timeout 300
            expect "Escape character"
            send "\r"
            expect " login: "
            send "root\r"
            expect "Password: "
            send "foobar\r"
            expect " ~]# "
            send "ip addr\r\n"
            expect " ~]# "
            exit 0
        """
        expect = subprocess.Popen(["expect", "--", "-", str(self._domain.ID())], stdin=subprocess.PIPE)
        expect.communicate(SCRIPT)

    def _ip_from_mac(self, mac, timeout_sec=300):
        # Get address from the arp arp output looks like this.
        #
        # IP address     HW type  Flags  HW address         Mask  Device
        # 10.111.118.45  0x1      0x0    9e:00:03:72:00:04  *     cockpit1
        # ...

        output = ""
        start_time = time.time()
        while (time.time() - start_time) < timeout_sec:
            with open("/proc/net/arp", "r") as fp:
                output = fp.read()
            for line in output.split("\n"):
                parts = re.split(' +', line)
                if len(parts) > 5 and parts[3].lower() == mac.lower() and parts[5] == self.network_name:
                    return parts[0]
            time.sleep(1)

        message = "{0}: [{1}]\n{2}\n".format(mac, ", ".join(self._qemu_network_macs()), output)
        sys.stderr.write(message)
        self._diagnose_no_address()
        raise RepeatableFailure("Can't resolve IP of " + mac)

    def reset_reboot_flag(self):
        self.event_handler.reset_domain_reboot_status(self._domain)

    def wait_reboot(self, wait_for_running_timeout=120):
        self.disconnect()
        if not self.event_handler.wait_for_reboot(self._domain):
            raise Failure("system didn't notify us about a reboot")
        # we may have to check for a new dhcp lease, but the old one can be active for a bit
        if not self.wait_execute(timeout_sec=wait_for_running_timeout, get_new_address=lambda: self._ip_from_mac(self.macaddr, timeout_sec=5)):
            raise Failure("system didn't reboot properly")
        self.wait_user_login()

    def wait_boot(self, wait_for_running_timeout = 120, allow_one_reboot=False):
        # we should check for selinux relabeling in progress here
        if not self.event_handler.wait_for_running(self._domain, timeout_sec=wait_for_running_timeout ):
            raise Failure("Machine %s didn't start." % (self.address))

        if not self.address:
            self.address = self._ip_from_mac(self.macaddr)

        # if we allow a reboot, the connection to test for a finished boot may be interrupted
        # by the reboot, causing an exception
        try:
            start_time = time.time()
            connected = False
            while (time.time() - start_time) < wait_for_running_timeout:
                if self.wait_execute(timeout_sec=15, get_new_address=lambda: self._ip_from_mac(self.macaddr, timeout_sec=3)):
                    connected = True
                    break
                if allow_one_reboot and self.event_handler.has_rebooted(self._domain):
                    self.reset_reboot_flag()
                    self.wait_boot(wait_for_running_timeout, allow_one_reboot=False)
            if not connected:
                self._diagnose_no_address()
                raise Failure("Unable to reach machine %s via ssh." % (self.address))
            self.wait_user_login()
        except:
            if allow_one_reboot:
                self.wait_reboot()
                self.reset_reboot_flag()
                self.wait_boot(wait_for_running_timeout, allow_one_reboot=False)
            else:
                raise

    def stop(self, timeout_sec=120):
        if self._maintaining:
            self.shutdown(timeout_sec=timeout_sec)
        else:
            self.kill()

    def _cleanup(self, quick=False):
        self.disconnect()
        try:
            if not quick:
                if hasattr(self, '_disks'):
                    for index in dict(self._disks):
                        self.rem_disk(index)

            self._disks = { }

            if self._domain:
                # remove the debug output
                self.event_handler.forbid_domain_debug_output(self._domain.name())

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
        self.disconnect()
        if self._domain:
            try:
                # not graceful
                with stdchannel_redirected(sys.stderr, os.devnull):
                    self._domain.destroyFlags(libvirt.VIR_DOMAIN_DESTROY_DEFAULT)
            except:
                pass
        self._cleanup(quick=True)

    def wait_poweroff(self, timeout_sec=120):
        # shutdown must have already been triggered
        if self._domain:
            if not self.event_handler.wait_for_stopped(self._domain, timeout_sec=timeout_sec):
                self.message("waiting for machine poweroff timed out")

        self._cleanup(quick=True)

    def shutdown(self, timeout_sec=120):
        # shutdown the system gracefully
        # to stop it immediately, use kill()
        self.disconnect()
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

        path = os.path.join(self.run_dir, "disk-%s-%d" % (self._domain.name(), index))
        if os.path.exists(path):
            os.unlink(path)

        subprocess.check_call(["qemu-img", "create", "-q", "-f", "raw", path, str(size)])

        dev = 'sd' + string.ascii_lowercase[index]
        disk_desc = self._domain_disk_template() % {
                          'file': path,
                          'serial': serial,
                          'unit': index,
                          'dev': dev
                        }

        if self._domain.attachDeviceFlags(disk_desc, libvirt.VIR_DOMAIN_AFFECT_LIVE) != 0:
            raise Failure("Unable to add disk to vm")

        self._disks[index] = {
            "path": path,
            "serial": serial,
            "filename": path,
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
        disk_desc = self._domain_disk_template() % {'file': filename, 'serial': serial, 'unit': index, 'dev': dev}

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

        disk_desc = self._domain_disk_template() % {
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
        if "atomic" in self.image:
            self.execute(command="mount -o remount,rw /usr")

    def wait_for_cockpit_running(self, address="localhost", port=9090, seconds=30):
        WAIT_COCKPIT_RUNNING = """#!/bin/sh
until curl -s --connect-timeout 2 --max-time 3 http://%s:%s >/dev/null; do
    sleep 0.5;
done;
""" % (address, port)
        with Timeout(seconds=seconds, error_message="Timeout while waiting for cockpit to start"):
            self.execute(script=WAIT_COCKPIT_RUNNING)
