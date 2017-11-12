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

import os
import re
import subprocess
import shutil

from avocado.utils import process
from testlib import Browser

class Cockpit():

    def __init__(self,):
        self.cleanup_funcs = []
        self.setUp()

    def atcleanup(self, func):
        self.cleanup_funcs.append(func)

    def run_shell_command(self, cmd, cleanup_cmd=None):
        if cleanup_cmd:
            self.atcleanup(lambda: process.run(cleanup_cmd, shell=True))
        process.run(cmd, shell=True)

    def replace_file(self, file, content):
        def restore():
            shutil.copyfile(file + ".cockpitsave", file)
            os.remove(file + ".cockpitsave")
        shutil.copyfile(file, file + ".cockpitsave")
        self.atcleanup(restore)
        with open(file, 'w') as f:
            f.write(content)

    def setUp(self):
        #        state = self.get_state()
        self.label = ("avocado")
        self.browser = Browser("localhost", self.label)
        self.journal_start = re.sub('.*cursor: ', '',
                                    subprocess.check_output("journalctl --show-cursor -n0 -o cat || true", shell=True))

    def tearDown(self):
        pass
        # self.check_journal_messages()
        for foo in self.cleanup_funcs:
            foo()

        # Make a final screenshot and save the journal for the test run.
        #
        # TODO: Do this only when the test has failed.
        #
        # self.browser.snapshot("DONE")
        #process.run("journalctl >'%s.journal' -c'%s'" % (self.label, self.journal_start), shell=True)

        # If this is a remote run, copy all screenshots and journals
        # to the results directory so that they get copied out of the
        # virtual machine.
        #
        # The status of "cp" is ignored because it will fail when
        # there are no screenshots or journals, but that is not really
        # an error.
        #
        # TODO: Do this only once after running all tests.
        #
        # if not state['job_logdir'].startswith("/tmp/"):
        #    process.run("cp -v *.png *.journal '%s'" %  state['job_logdir'],
        #                shell=True, ignore_status=True)

        #for f in self.cleanup_funcs: f()

        #process.run("systemctl stop cockpit.socket cockpit.service", shell=True)

    allowed_messages = [
        # This is a failed login, which happens every time
        "Returning error-response 401 with reason `Sorry'",

        # Reboots are ok
        "-- Reboot --",

        # Sometimes D-Bus goes away before us during shutdown
        "Lost the name com.redhat.Cockpit on the session message bus",
        "GLib-GIO:ERROR:gdbusobjectmanagerserver\\.c:.*:g_dbus_object_manager_server_emit_interfaces_.*: assertion failed \\(error == NULL\\): The connection is closed \\(g-io-error-quark, 18\\)",
        "Error sending message: The connection is closed",

        # Will go away with glib 2.43.2
        ".*: couldn't write web output: Error sending data: Connection reset by peer",

        # Bugs

        # https://bugs.freedesktop.org/show_bug.cgi?id=70540
        ".*ActUserManager: user .* has no username.*",

        # https://github.com/cockpit-project/cockpit/issues/48
        "Failed to load '.*': Key file does not have group 'Unit'",

        # https://github.com/cockpit-project/cockpit/issues/115
        "cockpit\\.service: main process exited, code=exited, status=1/FAILURE",
        "Unit cockpit\\.service entered failed state\\.",

        # https://bugs.freedesktop.org/show_bug.cgi?id=71092
        "logind\\.KillUser failed \\(Input/output error\\), trying systemd\\.KillUnit",

        # SELinux messages to ignore
        "(audit: )?type=1403 audit.*",
        "(audit: )?type=1404 audit.*",

        # Hmm
        "request timed out, closing",
        "(audit: )?type=1400 .* name=\"machine-info\".*",
        "pam_lastlog\\(cockpit:session\\): unable to open /var/log/lastlog: No such file or directory"
    ]

    def allow_journal_messages(self, *patterns):
        """Don't fail if the journal containes a entry matching the given regexp"""
        for p in patterns:
            self.allowed_messages.append(p)

    def allow_restart_journal_messages(self):
        self.allow_journal_messages("Error receiving data: Connection reset by peer",
                                    "g_dbus_connection_real_closed: Remote peer vanished with error: Underlying GIOStream returned 0 bytes on an async read \\(g-io-error-quark, 0\\). Exiting.",
                                    "g_dbus_connection_real_closed: Remote peer vanished with error: Error sending message: Broken pipe \\(g-io-error-quark, 44\\). Exiting.",
                                    # HACK:
                                    # https://bugzilla.redhat.com/show_bug.cgi?id=1141137
                                    "localhost: bridge program failed: Child process killed by signal 9")

    def journal_messages(self, syslog_ids, log_level):
        """Return interesting journal messages"""

        # Journald does not always set trusted fields like
        # _SYSTEMD_UNIT or _EXE correctly for the last few messages of
        # a dying process, so we filter by the untrusted but reliable
        # SYSLOG_IDENTIFIER instead

        matches = " ".join(
            map(lambda id: "SYSLOG_IDENTIFIER=" + id, syslog_ids))

        # Some versions of journalctl terminate unsuccessfully when
        # the output is empty.  We work around this by ignoring the
        # exit status and including error messages from journalctl
        # itself in the returned messages.

        cmd = "journalctl 2>&1 -c'%s' -o cat -p %d %s" % (
            self.journal_start, log_level, matches)
        out = process.run(cmd, shell=True, ignore_status=True)
        messages = out.stdout.splitlines()
        if len(messages) == 1 and "Cannot assign requested address" in messages[0]:
            # No messages
            return []
        else:
            return messages

    def audit_messages(self, type_pref):
        cmd = "journalctl -c'%s' -o cat SYSLOG_IDENTIFIER=kernel 2>&1 | grep 'type=%s.*audit' || true" % (
            self.journal_start, type_pref)
        out = process.run(cmd, shell=True)
        messages = out.stdout.splitlines()
        if len(messages) == 1 and "Cannot assign requested address" in messages[0]:
            messages = []
        return messages

    def check_journal_messages(self):
        """Check for unexpected journal entries."""
        syslog_ids = ["cockpit-wrapper", "cockpit-ws", "cockpit-session"]
        messages = self.journal_messages(syslog_ids, 5)
        messages += self.audit_messages("14")  # 14xx is selinux
        all_found = True
        first = None
        for m in messages:
            found = False
            for p in self.allowed_messages:
                match = re.match(p, m)
                if match and match.group(0) == m:
                    found = True
                    break
            if not found:
                print("Unexpected journal message '%s'" % m)
                all_found = False
                if not first:
                    first = m
        self.assertTrue(all_found, msg=first)
