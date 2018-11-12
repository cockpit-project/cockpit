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

from . import ssh_connection
from . import timeout
from .constants import DEFAULT_IDENTITY_FILE, ATOMIC_IMAGES, TEST_DIR

LOGIN_MESSAGE = """
TTY LOGIN
  User: {ssh_user}/admin  Password: foobar
  To quit use Ctrl+], Ctrl+5 (depending on locale)

SSH ACCESS
  $ ssh -p {ssh_port} {ssh_user}@{ssh_address}
  Password: foobar

COCKPIT
  http://{web_address}:{web_port}
"""

RESOLV_SCRIPT = """
set -e
# HACK: Racing with operating systems reading/updating resolv.conf and
# the fact that resolv.conf can be a symbolic link. Avoid failures like:
# chattr: Operation not supported while reading flags on /etc/resolv.conf
mkdir -p /etc/NetworkManager/conf.d
printf '[main]\ndns=none\n' > /etc/NetworkManager/conf.d/dns.conf
systemctl reload-or-restart NetworkManager
printf 'domain {domain}\nsearch {domain}\nnameserver {nameserver}\n' >/etc/resolv2.conf
chcon -v unconfined_u:object_r:net_conf_t:s0 /etc/resolv2.conf 2> /dev/null || true
mv /etc/resolv2.conf /etc/resolv.conf
"""


class Machine(ssh_connection.SSHConnection):
    def __init__(self, address="127.0.0.1", image="unknown", verbose=False, label=None, browser=None,
                 user="root", identity_file=None, arch="x86_64", ssh_port=22, web_port=9090):

        identity_file_old = identity_file
        identity_file = identity_file or DEFAULT_IDENTITY_FILE

        if identity_file_old is None:
            os.chmod(identity_file, 0o600)
        if ":" in address:
            (ssh_address, unused, ssh_port) = address.rpartition(":")
        else:
            ssh_address = address
            ssh_port = ssh_port
        if not browser:
            browser = address

        super(Machine, self).__init__(user, ssh_address, ssh_port, identity_file, verbose=verbose)

        self.arch = arch
        self.image = image
        self.atomic_image = self.image in ATOMIC_IMAGES
        if ":" in browser:
            (self.web_address, unused, self.web_port) = browser.rpartition(":")
        else:
            self.web_address = browser
            self.web_port = web_port
        if label:
            self.label = label
        elif self.image is not "unknown":
            self.label = "{}-{}-{}".format(self.image, self.ssh_address, self.ssh_port)
        else:
            self.label = "{}@{}:{}".format(self.ssh_user, self.ssh_address, self.ssh_port)

        # The Linux kernel boot_id
        self.boot_id = None

    def diagnose(self):
        keys = {
            "ssh_user": self.ssh_user,
            "ssh_address": self.ssh_address,
            "ssh_port": self.ssh_port,
            "web_address": self.web_address,
            "web_port": self.web_port,
        }
        return LOGIN_MESSAGE.format(**keys)

    def start(self):
        """Overridden by machine classes to start the machine"""
        self.message("Assuming machine is already running")

    def stop(self):
        """Overridden by machine classes to stop the machine"""
        self.message("Not shutting down already running machine")

    def wait_poweroff(self):
        """Overridden by machine classes to wait for a machine to stop"""
        assert False, "Cannot wait for a machine we didn't start"

    def kill(self):
        """Overridden by machine classes to unconditionally kill the running machine"""
        assert False, "Cannot kill a machine we didn't start"

    def shutdown(self):
        """Overridden by machine classes to gracefully shutdown the running machine"""
        assert False, "Cannot shutdown a machine we didn't start"

    def upload(self, sources, dest, relative_dir=TEST_DIR):
        """Upload a file into the test machine

        Arguments:
            sources: the array of paths of the file to upload
            dest: the file path in the machine to upload to
        """
        super(Machine, self).upload(sources, dest, relative_dir)

    def download(self, source, dest, relative_dir=TEST_DIR):
        """Download a file from the test machine.
        """
        super(Machine, self).download(source, dest, relative_dir)

    def download_dir(self, source, dest, relative_dir=TEST_DIR):
        """Download a directory from the test machine, recursively.
        """
        super(Machine, self).download_dir(source, dest, relative_dir)

    def journal_cursor(self):
        """Return current journal cursor

        This can be passed to journal_messages() or audit_messages().
        """
        return self.execute("journalctl --show-cursor -n0 -o cat | sed 's/^.*cursor: *//'")

    def journal_messages(self, syslog_ids, log_level, cursor=None):
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

        if cursor:
            cursor_arg = "--cursor '%s'" % cursor
        else:
            cursor_arg = ""

        cmd = "journalctl 2>&1 %s -o cat -p %d %s || true" % (cursor_arg, log_level, matches)
        messages = self.execute(cmd).splitlines()
        if len(messages) == 1 and ("Cannot assign requested address" in messages[0]
                                   or "-- No entries --" in messages[0]):
            # No messages
            return [ ]
        else:
            return messages

    def audit_messages(self, type_pref, cursor=None):
        if cursor:
            cursor_arg = "--cursor '%s'" % cursor
        else:
            cursor_arg = ""

        cmd = "journalctl %s -o cat SYSLOG_IDENTIFIER=kernel 2>&1 | grep 'type=%s.*audit' || true" % (cursor_arg, type_pref, )
        messages = self.execute(cmd).splitlines()
        if len(messages) == 1 and "Cannot assign requested address" in messages[0]:
            messages = [ ]
        return messages

    def get_admin_group(self):
        if "debian" in self.image or "ubuntu" in self.image:
            return "sudo"
        else:
            return "wheel"

    def start_cockpit(self, atomic_wait_for_host=None, tls=False):
        """Start Cockpit.

        Cockpit is not running when the test virtual machine starts up, to
        allow you to make modifications before it starts.
        """

        if self.atomic_image:
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
            with timeout.Timeout(seconds=90, error_message="Timeout while waiting for cockpit/ws to start"):
                self.execute(script=cmd)
            self.wait_for_cockpit_running(atomic_wait_for_host or "localhost")
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
        if self.atomic_image:
            with timeout.Timeout(seconds=90, error_message="timeoutlib.Timeout while waiting for cockpit/ws to restart"):
                self.execute("docker restart `docker ps | grep cockpit/ws | awk '{print $1;}'`")
            self.wait_for_cockpit_running()
        else:
            self.execute("systemctl restart cockpit")

    def stop_cockpit(self):
        """Stop Cockpit.
        """
        if self.atomic_image:
            with timeout.Timeout(seconds=60, error_message="Timeout while waiting for cockpit/ws to stop"):
                self.execute("docker kill `docker ps | grep cockpit/ws | awk '{print $1;}'`")
        else:
            self.execute("systemctl stop cockpit.socket cockpit.service")

    def set_address(self, address, mac='52:54:01'):
        """Set IP address for the network interface with given mac prefix"""
        cmd = "nmcli con add type ethernet autoconnect yes con-name static-{mac} ifname \"$(grep -l '{mac}' /sys/class/net/*/address | cut -d / -f 5)\" ip4 {address} && ( nmcli conn up static-{mac} || true )"
        self.execute(cmd.format(mac=mac, address=address))

    def set_dns(self, nameserver=None, domain=None):
        self.execute(RESOLV_SCRIPT.format(nameserver=nameserver or "127.0.0.1", domain=domain or "cockpit.lan"))

    def dhcp_server(self, mac='52:54:01', range=['10.111.112.2', '10.111.127.254']):
        """Sets up a DHCP server on the interface"""
        cmd = "dnsmasq --domain=cockpit.lan --interface=\"$(grep -l '{mac}' /sys/class/net/*/address | cut -d / -f 5)\" --bind-dynamic --dhcp-range=" + ','.join(range) + " && firewall-cmd --add-service=dhcp"
        self.execute(cmd.format(mac=mac))

    def dns_server(self, mac='52:54:01'):
        """Sets up a DNS server on the interface"""
        cmd = "dnsmasq --domain=cockpit.lan --interface=\"$(grep -l '{mac}' /sys/class/net/*/address | cut -d / -f 5)\" --bind-dynamic"
        self.execute(cmd.format(mac=mac))

    def wait_for_cockpit_running(self, address="localhost", port=9090, seconds=30):
        WAIT_COCKPIT_RUNNING = """#!/bin/sh
        until curl -s --connect-timeout 2 --max-time 3 http://%s:%s >/dev/null; do
            sleep 0.5;
        done;
        """ % (address, port)
        with timeout.Timeout(seconds=seconds, error_message="Timeout while waiting for cockpit to start"):
            self.execute(script=WAIT_COCKPIT_RUNNING)
