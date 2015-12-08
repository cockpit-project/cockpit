#!/usr/bin/env python
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

import argparse
import datetime
import errno
import httplib
import json
import urllib
import os
import random
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import urlparse

TOKEN = "~/.config/github-token"
topdir = os.path.normpath(os.path.dirname(__file__))

# the user name is accepted if it's found in either list
WHITELIST = os.path.join(topdir, "files/github-whitelist")
WHITELIST_LOCAL = "~/.config/github-whitelist"

HOSTNAME = socket.gethostname().split(".")[0]
DEFAULT_IMAGE = os.environ.get("TEST_OS", "fedora-22")

DEFAULT_VERIFY = {
    'fedora-22': [ 'master', 'pulls' ],
    'fedora-23': [ 'master', 'pulls' ],
    'rhel-7': [ 'master', 'pulls' ],
    'fedora-atomic': [ 'master' ],
    'fedora-testing': [ 'master' ],
}

TESTING = "Testing in progress"
NOT_TESTED = "Not yet tested"

__all__ = (
    'Sink',
    'GitHub',
    'arg_parser',
    'DEFAULT_IMAGE',
    'HOSTNAME',
    'TESTING',
    'NOT_TESTED'
)

def arg_parser():
    parser = argparse.ArgumentParser(description='Run Cockpit test(s)')
    parser.add_argument('-j', '--jobs', dest="jobs", type=int,
                        default=os.environ.get("TEST_JOBS", 1), help="Number of concurrent jobs")
    parser.add_argument('-v', '--verbose', dest="verbosity", action='store_const',
                        const=2, help='Verbose output')
    parser.add_argument('-t', "--trace", dest='trace', action='store_true',
                        help='Trace machine boot and commands')
    parser.add_argument('-q', '--quiet', dest='verbosity', action='store_const',
                        const=0, help='Quiet output')
    parser.add_argument('--thorough', dest='thorough', action='store_true',
                        help='Thorough mode, no skipping known issues')
    parser.add_argument('-s', "--sit", dest='sit', action='store_true',
                        help="Sit and wait after test failure")
    parser.add_argument('tests', nargs='*')

    parser.set_defaults(verbosity=1)
    return parser

def read_whitelist():
    # Try to load the whitelists
    # Always expect the in-tree version to be present
    whitelist = None
    with open(WHITELIST, "r") as wh:
        whitelist = [x.strip() for x in wh.read().split("\n") if x.strip()]

    # The local file may or may not exist
    try:
        wh = open(WHITELIST_LOCAL, "r")
        whitelist += [x.strip() for x in wh.read().split("\n") if x.strip()]
    except IOError as exc:
        if exc.errno == errno.ENOENT:
            pass
        else:
            raise

    # remove duplicate entries
    return set(whitelist)

class Sink(object):
    def __init__(self, host, identifier, status=None):
        self.attachments = tempfile.mkdtemp(prefix="attachments.", dir=".")
        self.status = status

        # Start a gzip and cat processes
        self.ssh = subprocess.Popen([ "ssh", host, "--", "python", "sink", identifier ], stdin=subprocess.PIPE)

        # Send the status line
        if status is None:
            line = "\n"
        else:
            json.dumps(status) + "\n"
        self.ssh.stdin.write(json.dumps(status) + "\n")

        # Now dup our own output and errors into the pipeline
        sys.stdout.flush()
        self.fout = os.dup(1)
        os.dup2(self.ssh.stdin.fileno(), 1)
        sys.stderr.flush()
        self.ferr = os.dup(2)
        os.dup2(self.ssh.stdin.fileno(), 2)

    def attach(self, filename):
        shutil.move(filename, self.attachments)

    def flush(self, status=None):
        assert self.ssh is not None

        # Reset stdout back
        sys.stdout.flush()
        os.dup2(self.fout, 1)
        os.close(self.fout)
        self.fout = -1

        # Reset stderr back
        sys.stderr.flush()
        os.dup2(self.ferr, 2)
        os.close(self.ferr)
        self.ferr = -1

        # Splice in the github status
        if status is None:
            status = self.status
        if status is not None:
            self.ssh.stdin.write("\n" + json.dumps(status))

        # Send a zero character and send the attachments
        files = os.listdir(self.attachments)
        if len(files):
            self.ssh.stdin.write('\x00')
            self.ssh.stdin.flush()
            with tarfile.open(name="attachments.tgz", mode="w:gz", fileobj=self.ssh.stdin) as tar:
                for filename in files:
                    tar.add(os.path.join(self.attachments, filename), arcname=filename, recursive=True)
        shutil.rmtree(self.attachments)

        # All done sending output
        self.ssh.stdin.close()

        # SSH should terminate by itself
        ret = self.ssh.wait()
        if ret != 0:
            raise subprocess.CalledProcessError(ret, "ssh")
        self.ssh = None

def dict_is_subset(full, check):
    for (key, value) in check.items():
        if not key in full or full[key] != value:
            return False
    return True

class GitHub(object):
    def __init__(self, base="/repos/cockpit-project/cockpit/"):
        self.base = base
        self.conn = None
        self.token = None
        self.debug = False
        try:
            gt = open(os.path.expanduser(TOKEN), "r")
            self.token = gt.read().strip()
            gt.close()
        except IOError as exc:
            if exc.errno == errno.ENOENT:
                pass
            else:
                raise
        self.available = self.token and True or False

    def qualify(self, resource):
        return urlparse.urljoin(self.base, resource)

    def request(self, method, resource, data="", headers=None, return_headers_on_unmodified=False):
        if headers is None:
            headers = { }
        headers["User-Agent"] = "Cockpit Tests"
        if self.token:
            headers["Authorization"] = "token " + self.token
        connected = False
        while not connected:
            if not self.conn:
                self.conn = httplib.HTTPSConnection("api.github.com", strict=True)
                connected = True
            self.conn.set_debuglevel(self.debug and 1 or 0)
            try:
                self.conn.request(method, self.qualify(resource), data, headers)
                response = self.conn.getresponse()
                break
            # This happens when GitHub disconnects a keep-alive connection
            except httplib.BadStatusLine:
                if connected:
                    raise
                self.conn = None
        output = response.read()
        if method == "GET" and response.status == 404:
            return ""
        elif response.status == 304: # not modified
            if return_headers_on_unmodified:
                return response.getheaders()
            else:
                return None
        elif response.status < 200 or response.status >= 300:
            sys.stderr.write(output)
            raise Exception("GitHub API problem: {0}".format(response.reason or response.status))
        return output

    def get(self, resource):
        output = self.request("GET", resource)
        if not output:
            return None
        return json.loads(output)

    def post(self, resource, data):
        headers = { "Content-Type": "application/json" }
        return json.loads(self.request("POST", resource, json.dumps(data), headers))

    def statuses(self, revision):
        result = { }
        statuses = self.get("commits/{0}/statuses".format(revision))
        if statuses:
            for status in statuses:
                if status["context"] not in result:
                    result[status["context"]] = status
        return result

    def labels(self, issue):
        result = [ ]
        for label in self.get("issues/{0}/labels".format(issue)):
            result.append(label["name"])
        return result

    def prioritize(self, status, labels, priority):
        state = status.get("state", None)
        update = { "state": "pending" }

        # This commit definitively succeeded or failed
        if state in [ "success", "failure" ]:
            priority = 0
            update = None

        # This test errored, we try again but low priority
        elif state in [ "error" ]:
            priority -= 6

        elif state in [ "pending" ]:
            update = None

        if priority > 0:
            if "priority" in labels:
                priority += 2
            if "needsdesign" in labels:
                priority -= 2
            if "needswork" in labels:
                priority -= 3
            if "blocked" in labels:
                priority -= 1

            # Is testing already in progress?
            if status.get("description", "").startswith(TESTING):
                priority = 0

        if update:
            if priority <= 0:
                update["description"] = "Manual testing required"
            else:
                update["description"] = NOT_TESTED

        return [priority, update]

    def scan(self, update, context):
        whitelist = read_whitelist()
        results = []

        # Figure out what contexts/images we need to verify
        contexts = DEFAULT_VERIFY
        if context:
            contexts = { context: contexts.get(context, [ "master" ]) }

        master_contexts = []
        pull_contexts = []
        for (context, what) in contexts.items():
            if "master" in what:
                master_contexts.append(context)
            if "pulls" in what:
                pull_contexts.append(context)

        def update_status(revision, context, last, changes):
            if update and changes and not dict_is_subset(last, changes):
                changes["context"] = context
                self.post("statuses/" + revision, changes)

        if master_contexts:
            master = self.get("git/refs/heads/master")
            revision = master["object"]["sha"]
            statuses = self.statuses(revision)
            for context in master_contexts:
                status = statuses.get(context, { })
                (priority, changes) = self.prioritize(status, [], 9)
                results.append((priority, "master", revision, "master", context))
                update_status(revision, context, status, changes)

        if pull_contexts:
            pulls = self.get("pulls")
            for pull in pulls:
                baseline = 10

                # It needs to be in the whitelist
                login = pull["head"]["user"]["login"]
                if login not in whitelist:
                    baseline = 0

                number = pull["number"]
                labels = self.labels(number)
                revision = pull["head"]["sha"]
                statuses = self.statuses(revision)

                for context in pull_contexts:
                    status = statuses.get(context, { })
                    (priority, changes) = self.prioritize(status, labels, baseline)
                    results.append((priority, "pull-%d" % number, revision, "pull/%d/head" % number, context))
                    update_status(revision, context, status, changes)

        # Only work on tasks that have a priority greater than zero
        def filter_tasks(task):
            return task[0] > 0

        # Prefer higher priorities, and "local" operating system
        def sort_key(task):
            key = task[0]
            if task[4] != DEFAULT_IMAGE:
                key -= random.randint(1, 3)
            return key

        random.seed()
        results = filter(filter_tasks, results)
        return sorted(results, key=sort_key, reverse=True)

    def httpdate(self, dt):
        """Return a string representation of a date according to RFC 1123
        (HTTP/1.1).

        The supplied date must be in UTC.

        From: http://stackoverflow.com/a/225106

        """
        weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][dt.weekday()]
        month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep",
                 "Oct", "Nov", "Dec"][dt.month - 1]
        return "%s, %02d %s %04d %02d:%02d:%02d GMT" % (weekday, dt.day, month,
            dt.year, dt.hour, dt.minute, dt.second)

    def check_limits(self):
        # in order for the limit not to be affected by the call itself,
        # use a conditional request with a timestamp in the future

        future_timestamp = datetime.datetime.utcnow() + datetime.timedelta(seconds=3600)

        info = self.request(method = "GET",
                            resource = "git/refs/heads/master",
                            data = "",
                            headers = { 'If-Modified-Since': self.httpdate(future_timestamp) },
                            return_headers_on_unmodified = True
                           )
        sys.stdout.write("Rate limits:\n")
        for entry in ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"]:
            entries = filter(lambda t: t[0].lower() == entry.lower(), info)
            if entries:
                if entry == "X-RateLimit-Reset":
                    try:
                        readable = datetime.datetime.utcfromtimestamp(float(entries[0][1])).isoformat()
                    except:
                        readable = "parse error"
                        pass
                    sys.stdout.write("{0}: {1} ({2})\n".format(entry, entries[0][1], readable))
                else:
                    sys.stdout.write("{0}: {1}\n".format(entry, entries[0][1]))

    def trigger(self, pull_number, force=False, context=None):
        if not context:
            context = DEFAULT_IMAGE
        sys.stderr.write("triggering pull {0} for context {1}\n".format(pull_number, context))
        pull = self.get("pulls/" + pull_number)

        # triggering is manual, so don't prevent triggering a user that isn't on the whitelist
        # but issue a warning in case of an oversight
        whitelist = read_whitelist()
        login = pull["head"]["user"]["login"]
        if login not in whitelist:
            sys.stderr.write("warning: pull request author '{0}' isn't in github-whitelist.\n".format(login))

        revision = pull['head']['sha']
        statuses = self.statuses(revision)
        status = statuses.get(context, { })
        if status.get("state", "empty") not in ["empty", "error", "failure"]:
            if force:
                sys.stderr.write("Pull request isn't in error state, but forcing update.\n")
            else:
                sys.stderr.write("Pull request isn't in error state. Status is: '{0}'\n".format(status["state"]))
                return

        changes = { "state": "pending", "description": NOT_TESTED, "context": context }
        self.post("statuses/" + revision, changes)

if __name__ == '__main__':
    github = GitHub("/repos/cockpit-project/cockpit/")
    parser = argparse.ArgumentParser(description='Test infrastructure: scan and update status of pull requests on github')
    parser.add_argument('-c', '--check', action="store_true", default=False,
                        help='Only check github rate limits with the currently configured credentials')
    parser.add_argument('-d', '--dry', action="store_true", default=False,
                        help='Don''t actually change anything on github')
    parser.add_argument('image', action='store', nargs='?',
                        help='The operating system image to verify against')
    opts = parser.parse_args()

    if (opts.check):
        github.check_limits()
    else:
        for (priority, name, revision, ref, context) in github.scan(not opts.dry, opts.image):
            sys.stdout.write("{0}: {1} ({2} {3})\n".format(name, revision, priority, context))
