# This file is part of Cockpit.
#
# Copyright (C) 2016 Red Hat, Inc.
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
import subprocess
import sys
import traceback

import testinfra

class GithubPullTask(object):
    def __init__(self, name, revision, ref, context, base=None):
        self.name = name
        self.revision = revision
        self.ref = ref
        self.context = context
        self.base = base or "master"

        self.sink = None
        self.github_status_data = None

    def description(self):
        return "{0} {1} {2}".format(self.name, self.context, self.revision)

    def start_publishing(self, host, github):
        identifier = self.name + "-" + self.revision[0:8] + "-" + self.context.replace("/", "-")
        description = "{0} [{1}]".format(testinfra.TESTING, testinfra.HOSTNAME)

        self.github_status_data = {
            "state": "pending",
            "context": self.context,
            "description": description,
            "target_url": ":link"
        }

        status = {
            "github": {
                "token": github.token,
                "requests": [
                    # Set status to pending
                    { "method": "POST",
                      "resource": github.qualify("statuses/" + self.revision),
                      "data": self.github_status_data
                    }
                ]
            },
            "revision": self.revision,
            "link": "log.html",
            "extras": [ "https://raw.githubusercontent.com/cockpit-project/cockpit/master/test/common/log.html" ],

            "onaborted": {
                "github": {
                    "token": github.token,
                    "requests": [
                        # Set status to error
                        { "method": "POST",
                          "resource": github.qualify("statuses/" + self.revision),
                          "data": {
                              "state": "error",
                              "context": self.context,
                              "description": "Aborted without status",
                              "target_url": ":link"
                          }
                        }
                    ]
                },
            }
        }

        (prefix, unused, image) = self.context.partition("/")
        if self.name == "master" and prefix == "verify":
            status['irc'] = { }    # Only send to IRC when master
            status['badge'] = {
                'name': image,
                'description': image,
                'status': 'running'
            }
            status['onaborted']['badge'] = {
                'name': image,
                'description': image,
                'status': 'error'
            }

        # For other scripts to use
        os.environ["TEST_DESCRIPTION"] = description
        self.sink = testinfra.Sink(host, identifier, status)

    def check_publishing(self, github):
        if not self.sink:
            return True

        if not self.github_status_data:
            return True
        expected = self.github_status_data["description"]
        context = self.github_status_data["context"]
        statuses = github.statuses(self.sink.status["revision"])
        status = statuses.get(context, None)
        current = status.get("description", None)
        if current and current != expected:
            self.sink.status.pop("github", None)
            self.sink.status.pop("badge", None)
            self.sink.status.pop("irc", None)
            sys.stderr.write("Verify collision: {0}\n".format(current))
            return False
        return True

    def rebase(self, offline=False):
        try:
            sys.stderr.write("Rebasing onto origin/" + self.base + " ...\n")
            if not offline:
                subprocess.check_call([ "git", "fetch", "origin", self.base ])
            if self.sink:
                master = subprocess.check_output([ "git", "rev-parse", "origin/" + self.base ]).strip()
                self.sink.status["master"] = master
            subprocess.check_call([ "git", "rebase", "origin/" + self.base ])
            return None
        except:
            subprocess.call([ "git", "rebase", "--abort" ])
            traceback.print_exc()
            return "Rebase failed"

    def stop_publishing(self, ret):
        sink = self.sink
        def mark_failed():
            if "github" in sink.status:
                self.github_status_data["state"] = "failure"
            if 'badge' in sink.status:
                sink.status['badge']['status'] = "failed"
            if "irc" in sink.status: # Never send success messages to IRC
                sink.status["irc"]["channel"] = "#cockpit"
        def mark_passed():
            if "github" in sink.status:
                self.github_status_data["state"] = "success"
            if 'badge' in sink.status:
                sink.status['badge']['status'] = "passed"
        if isinstance(ret, basestring):
            message = ret
            mark_failed()
        elif ret == 0:
            message = "Tests passed"
            mark_passed()
        else:
            message = "{0} tests failed".format(ret)
            mark_failed()
        sink.status["message"] = message
        if "github" in sink.status:
            self.github_status_data["description"] = message
        del sink.status["extras"]
        sink.flush()

    def run(self, opts, github):

        if self.ref:
            subprocess.check_call([ "git", "fetch", "origin", self.ref ])
            subprocess.check_call([ "git", "checkout", "-f", self.revision ])

        # Split a value like verify/fedora-24
        (prefix, unused, value) = self.context.partition("/")

        os.environ["TEST_NAME"] = self.name
        os.environ["TEST_REVISION"] = self.revision

        if prefix in [ 'selenium' ]:
            os.environ["TEST_OS"] = 'fedora-24'
        elif prefix in [ 'container' ]:
            os.environ["TEST_OS"] = 'fedora-24'
        else:
            os.environ["TEST_OS"] = value

        if opts.publish:
            self.start_publishing(opts.publish, github)
            os.environ["TEST_ATTACHMENTS"] = self.sink.attachments

        msg = "Testing {0} for {1} with {2} on {3}...\n".format(self.revision, self.name,
                                                                self.context, testinfra.HOSTNAME)
        sys.stderr.write(msg)

        ret = None
        # Figure out what to do next
        if prefix == "verify":
            cmd = [ "timeout", "120m", "./verify/run-tests", "--install", "--jobs", str(opts.jobs) ]
        elif prefix == "avocado":
            cmd = [ "timeout", "60m", "./avocado/run-tests", "--install", "--quick", "--tests" ]
        elif prefix == "koji":
            cmd = [ "timeout", "120m", "./koji/run-build" ]
        elif prefix == "selenium":
            if value not in ['firefox', 'chrome']:
                ret = "Unknown browser for selenium test"
            cmd = [ "timeout", "60m", "./avocado/run-tests", "--install", "--quick", "--selenium-tests", "--browser", value]
        elif prefix == "image" or prefix == "container":
            cmd = [ "timeout", "90m", "./containers/run-tests", "--install", "--container", value]
        else:
            ret = "Unknown context"

        if cmd and opts.verbose:
            cmd.append("--verbose")

        offline = ('offline' in opts) and opts.offline
        ret = ret or self.rebase(offline)

        # Actually run the tests
        if not ret:
            proc = subprocess.Popen(cmd)
            ret = testinfra.wait_testing(proc, lambda: self.check_publishing(github))
            if ret == 124:
                ret = "Test run has timed out"

        # All done
        if self.sink:
            self.stop_publishing(ret)

        return ret
