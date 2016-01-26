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
import time
import urlparse

from testpulltask import GithubPullTask
from testimagetask import GithubImageTask

TOKEN = "~/.config/github-token"
topdir = os.path.normpath(os.path.dirname(os.path.realpath(__file__)))

# the user name is accepted if it's found in either list
WHITELIST = os.path.join(topdir, "files/github-whitelist")
WHITELIST_LOCAL = "~/.config/github-whitelist"

HOSTNAME = socket.gethostname().split(".")[0]
DEFAULT_IMAGE = os.environ.get("TEST_OS", "fedora-23")

BASELINE_PRIORITY = 10

DEFAULT_VERIFY = {
    'verify/fedora-22': [ 'master' ],
    'verify/fedora-23': [ 'master', 'pulls' ],
    'verify/rhel-7': [ 'master', 'pulls' ],
    'verify/fedora-atomic': [ 'master', 'pulls' ],
    'verify/rhel-atomic': [ 'master', 'pulls' ],
    'verify/debian-unstable': [ 'master', 'pulls' ],
    'verify/fedora-testing': [ 'master' ],
    'avocado/fedora-23': [ 'master', 'pulls' ],
    'selenium/firefox': [ 'master', 'pulls' ],
    'selenium/chrome': [ 'master', 'pulls' ],
    'image/kubernetes': [ ],
}

TESTING = "Testing in progress"
NOT_TESTED = "Not yet tested"
NO_TESTING = "Manual testing required"

DEFAULT_IMAGE_REFRESH = {
    'fedora-22': {
        'triggers': [ "verify/fedora-22" ]
    },
    'fedora-23': {
        'triggers': [
            "verify/fedora-23",
            "verify/fedora-atomic",  # builds in fedora-23
            "avocado/fedora-23",
            "selenium/firefox",
            "selenium/chrome"
        ]
    },
    'fedora-atomic': {
        'triggers': [ "verify/fedora-atomic" ]
    },
    'debian-unstable': {
        'triggers': [ "verify/debian-unstable" ]
    },
    'fedora-testing': {
        'triggers': [ "verify/fedora-testing" ]
    }
}

ISSUE_TITLE_IMAGE_REFRESH = "Image refresh for {0}"

# Days after which a image is refreshed
IMAGE_REFRESH = 7

# Days after which images expire if not in use
IMAGE_EXPIRE = 14

__all__ = (
    'Sink',
    'GitHub',
    'DEFAULT_IMAGE',
    'DEFAULT_VERIFY',
    'HOSTNAME',
    'TESTING',
    'NOT_TESTED',
    'IMAGE_EXPIRE',
)

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
        self.attachments = tempfile.mkdtemp(prefix="attachments.", dir=os.path.join(topdir, "tmp"))
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

        # Try to load the whitelists
        self.whitelist = read_whitelist()

        # The cache directory
        self.cache_directory = os.path.join(topdir, "tmp", "cache")
        if not os.path.exists(self.cache_directory):
            os.makedirs(self.cache_directory)
        now = time.time()
        for filename in os.listdir(self.cache_directory):
            path = os.path.join(self.cache_directory, filename)
            if os.path.isfile(path) and os.stat(path).st_mtime < now - 7 * 86400:
                os.remove(path)

    def qualify(self, resource):
        return urlparse.urljoin(self.base, resource)

    def request(self, method, resource, data="", headers=None):
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
        heads = { }
        for (header, value) in response.getheaders():
            heads[header.lower()] = value
        return {
            "status": response.status,
            "reason": response.reason,
            "headers": heads,
            "data": response.read()
        }

    def cache(self, resource, response=None):
        path = os.path.join(self.cache_directory, urllib.quote(resource, safe=''))
        if response is None:
            if not os.path.exists(path):
                return None
            with open(path, 'r') as fp:
                return json.load(fp)
        else:
            with open(path, 'w') as fp:
                json.dump(response, fp)

    def get(self, resource):
        headers = { }
        cached = self.cache(resource)
        if cached:
            etag = cached['headers'].get("etag", None)
            if etag:
                headers['If-None-Match'] = etag
        response = self.request("GET", resource, "", headers)
        if response['status'] == 404:
            return None
        elif cached and response['status'] == 304: # Not modified
            return json.loads(cached['data'])
        elif response['status'] < 200 or response['status'] >= 300:
            raise Exception("GitHub API problem: {0}".format(response['reason'] or response['status']))
        else:
            self.cache(resource, response)
            return json.loads(response['data'])

    def post(self, resource, data, accept=[]):
        response = self.request("POST", resource, json.dumps(data), { "Content-Type": "application/json" })
        status = response['status']
        if (status < 200 or status >= 300) and status not in accept:
            sys.stderr.write("{0}\n{1}\n".format(resource, response['data']))
            raise Exception("GitHub API problem: {0}".format(response['reason'] or status))
        return json.loads(response['data'])

    def statuses(self, revision):
        result = { }
        page = 1
        count = 100
        while count == 100:
            statuses = self.get("commits/{0}/statuses?page={1}&per_page={2}".format(revision, page, count))
            count = 0
            page += 1
            if statuses:
                for status in statuses:
                    if status["context"] not in result:
                        result[status["context"]] = status
                count = len(statuses)
        return result

    def labels(self, issue):
        result = [ ]
        for label in self.get("issues/{0}/labels".format(issue)):
            result.append(label["name"])
        return result

    class TaskEntry:
        def __init__(self, priority, task):
            self.priority = priority
            self.task = task

    def prioritize(self, status, labels, priority, context):
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

        # Don't start working on "bot" pull requests automatically.
        # The bot triggers them explicitly.
        elif "bot" in labels:
            priority = 0
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

        # Prefer "local" operating system
        if DEFAULT_IMAGE not in context:
            priority -= random.randint(1, 2)

        if update:
            if priority <= 0:
                update["description"] = NO_TESTING
            else:
                update["description"] = NOT_TESTED

        return [priority, update]

    def scan_for_pull_tasks(self, update, context, except_context=False):
        contexts = DEFAULT_VERIFY
        if context:
            for ctx in contexts.keys():
                if except_context:
                    if context in ctx:
                        contexts.pop(ctx)
                else:
                    if context not in ctx:
                        contexts.pop(ctx)

        results = []
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
                response = self.post("statuses/" + revision, changes, accept=[ 422 ]) # 422 Unprocessable Entity
                errors = response.get("errors", None)
                if not errors:
                    return True
                for error in response.get("errors", []):
                    sys.stderr.write("{0}: {1}\n".format(revision, error.get('message', json.dumps(error))))
                    sys.stderr.write(json.dumps(changes))
                return False
            return True

        if master_contexts:
            master = self.get("git/refs/heads/master")
            revision = master["object"]["sha"]
            statuses = self.statuses(revision)
            for context in master_contexts:
                status = statuses.get(context, { })
                (priority, changes) = self.prioritize(status, [], 8, context)
                if update_status(revision, context, status, changes):
                    results.append(GitHub.TaskEntry(priority, GithubPullTask("master", revision, "master", context)))

        pulls = self.get("pulls")
        for pull in pulls:
            number = pull["number"]
            labels = self.labels(number)
            revision = pull["head"]["sha"]
            statuses = self.statuses(revision)
            login = pull["head"]["user"]["login"]

            for context in contexts.keys():
                status = statuses.get(context, None)
                baseline = BASELINE_PRIORITY

                # Only create new status for those requested
                if not status:
                    if context not in pull_contexts:
                        continue
                    status = { }

                # For unmarked and untested status, user must be in whitelist
                # Not this only applies to this specific commit. A new status
                # will apply if the user pushes a new commit.
                if login not in self.whitelist:
                    if status.get("description", NO_TESTING) == NO_TESTING:
                        baseline = 0

                (priority, changes) = self.prioritize(status, labels, baseline, context)
                if update_status(revision, context, status, changes):
                    results.append(GitHub.TaskEntry(priority, GithubPullTask("pull-%d" % number, revision,
                                                                             "pull/%d/head" % number, context)))

        return results

    def scan_for_image_tasks(self):
        issues = self.get("issues?labels=bot")

        results = [ ]
        for image, config in DEFAULT_IMAGE_REFRESH.items():
            found = False
            for issue in issues:
                if issue['title'] == ISSUE_TITLE_IMAGE_REFRESH.format(image):
                    age = time.time() - time.mktime(time.strptime(issue['created_at'], "%Y-%m-%dT%H:%M:%SZ"))
                    if age < IMAGE_REFRESH * 24 * 60 * 60:
                        found = True
            if not found:
                results.append(GitHub.TaskEntry(BASELINE_PRIORITY, GithubImageTask("refresh-" + image, image,
                                                                                   config)))

        return results

    # Figure out what tasks needs doing
    #
    # Tasks include running tests on pull requests, and refreshing
    # images.
    #
    # The user can restrict the scope of tasks to scan for with
    # command line options.  When context is set, only tests for pull
    # requests are considered.  When except_context is True we check
    # everything except contexts that start with the specified
    # one. When it's False then the specified context is the only one
    # we scan tasks for.
    #
    # When context is not set, we scan for both pull requests (for any
    # context) and image refreshes.

    def scan(self, update, context, except_context=False):
        task_entries = self.scan_for_pull_tasks(update, context, except_context)

        # Add image tasks, but only if we are not explicitly scanning
        # for a pull context.
        if not context:
            task_entries += self.scan_for_image_tasks()

        # Only work on tasks that have a priority greater than zero
        def filter_entries(entry):
            return entry.priority > 0

        # Prefer higher priorities
        def sort_key(entry):
            return entry.priority

        random.seed()
        task_entries = filter(filter_entries, task_entries)
        return sorted(task_entries, key=sort_key, reverse=True)

def eintr_retry_call(func, *args):
    while True:
        try:
            return func(*args)
        except (OSError, IOError) as e:
            if e.errno == errno.EINTR:
                continue
            raise

# The goal here is that after 60 seconds we call check
def wait_testing(proc, check):
    count = 0
    flags = os.WNOHANG
    while True:
        pid, status = eintr_retry_call(os.waitpid, proc.pid, flags)
        if count < 60:
            time.sleep(1)
            count += 1
        elif count == 60:
            if not check():
                try:
                    proc.terminate()
                except OSError:
                    pass
            flags = 0
        if pid == proc.pid:
            if os.WIFSIGNALED(status):
                return os.WTERMSIG(status)
            else:
                return os.WEXITSTATUS(status)
