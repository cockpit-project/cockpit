#!/usr/bin/python3
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

# Shared GitHub code. When run as a script, we print out info about
# our GitHub interacition.

import errno
import http.client
import json
import os
import socket
import sys
import time
import urllib.parse

from . import cache

__all__ = (
    'GitHub',
    'Checklist',
    'TESTING',
    'NO_TESTING',
    'NOT_TESTED'
)

TESTING = "Testing in progress"
NOT_TESTED = "Not yet tested"
NO_TESTING = "Manual testing required"

OUR_CONTEXTS = [
    "verify/",
    "avocado/",
    "container/",
    "selenium/",

    # generic prefix for external repos
    "cockpit/",
]

ISSUE_TITLE_IMAGE_REFRESH = "Image refresh for {0}"

BASE = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
TOKEN = "~/.config/github-token"

TEAM_CONTRIBUTORS = "Contributors"

def known_context(context):
    for prefix in OUR_CONTEXTS:
        if context.startswith(prefix):
            return True
    return False

class Logger(object):
    def __init__(self, directory):
        hostname = socket.gethostname().split(".")[0]
        month = time.strftime("%Y%m")
        self.path = os.path.join(directory, "{0}-{1}.log".format(hostname, month))

        if not os.path.exists(directory):
            os.makedirs(directory)

    # Yes, we open the file each time
    def write(self, value):
        with open(self.path, 'a') as f:
            f.write(value)

class GitHub(object):
    def __init__(self, base=None, cacher=None, repo=None):
        if base is None:
            if repo is None:
                repo = os.environ.get("GITHUB_BASE", "cockpit-project/cockpit")
            netloc = os.environ.get("GITHUB_API", "https://api.github.com")
            base = "{0}/repos/{1}/".format(netloc, repo)
        self.url = urllib.parse.urlparse(base)
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

        # The cache directory is $TEST_DATA/github ~/.cache/github
        if not cacher:
            data = os.environ.get("TEST_DATA",  os.path.expanduser("~/.cache"))
            cacher = cache.Cache(os.path.join(data, "github"))
        self.cache = cacher

        # Create a log for debugging our GitHub access
        self.log = Logger(self.cache.directory)
        self.log.write("")

    def qualify(self, resource):
        return urllib.parse.urljoin(self.url.path, resource)

    def request(self, method, resource, data="", headers=None):
        if headers is None:
            headers = { }
        headers["User-Agent"] = "Cockpit Tests"
        if self.token:
            headers["Authorization"] = "token " + self.token
        connected = False
        while not connected:
            if not self.conn:
                if self.url.scheme == 'http':
                    self.conn = http.client.HTTPConnection(self.url.netloc)
                else:
                    self.conn = http.client.HTTPSConnection(self.url.netloc)
                connected = True
            self.conn.set_debuglevel(self.debug and 1 or 0)
            try:
                self.conn.request(method, self.qualify(resource), data, headers)
                response = self.conn.getresponse()
                break
            # This happens when GitHub disconnects in python3
            except ConnectionResetError:
                if connected:
                    raise
                self.conn = None
            # This happens when GitHub disconnects a keep-alive connection
            except http.client.BadStatusLine:
                if connected:
                    raise
                self.conn = None
            # This happens when TLS is the source of a disconnection
            except socket.error as ex:
                if connected or ex.errno != errno.EPIPE:
                    raise
                self.conn = None
        heads = { }
        for (header, value) in response.getheaders():
            heads[header.lower()] = value
        self.log.write('{0} - - [{1}] "{2} {3} HTTP/1.1" {4} -\n'.format(
            self.url.netloc,
            time.asctime(),
            method,
            resource,
            response.status
        ))
        return {
            "status": response.status,
            "reason": response.reason,
            "headers": heads,
            "data": response.read().decode('utf-8')
        }

    def get(self, resource):
        headers = { }
        qualified = self.qualify(resource)
        cached = self.cache.read(qualified)
        if cached:
            if self.cache.current(qualified):
                return json.loads(cached['data'] or "null")
            etag = cached['headers'].get("etag", None)
            modified = cached['headers'].get("last-modified", None)
            if etag:
                headers['If-None-Match'] = etag
            elif modified:
                headers['If-Modified-Since'] = modified
        response = self.request("GET", resource, "", headers)
        if response['status'] == 404:
            return None
        elif cached and response['status'] == 304: # Not modified
            self.cache.write(qualified, cached)
            return json.loads(cached['data'] or "null")
        elif response['status'] < 200 or response['status'] >= 300:
            sys.stderr.write("{0}\n{1}\n".format(resource, response['data']))
            raise RuntimeError("GitHub API problem: {0}".format(response['reason'] or response['status']))
        else:
            self.cache.write(qualified, response)
            return json.loads(response['data'] or "null")

    def post(self, resource, data, accept=[]):
        response = self.request("POST", resource, json.dumps(data), { "Content-Type": "application/json" })
        status = response['status']
        if (status < 200 or status >= 300) and status not in accept:
            sys.stderr.write("{0}\n{1}\n".format(resource, response['data']))
            raise RuntimeError("GitHub API problem: {0}".format(response['reason'] or status))
        self.cache.mark()
        return json.loads(response['data'])

    def patch(self, resource, data, accept=[]):
        response = self.request("PATCH", resource, json.dumps(data), { "Content-Type": "application/json" })
        status = response['status']
        if (status < 200 or status >= 300) and status not in accept:
            sys.stderr.write("{0}\n{1}\n".format(resource, response['data']))
            raise RuntimeError("GitHub API problem: {0}".format(response['reason'] or status))
        self.cache.mark()
        return json.loads(response['data'])

    def statuses(self, revision):
        result = { }
        page = 1
        count = 100
        while count == 100:
            data = self.get("commits/{0}/status?page={1}&per_page={2}".format(revision, page, count))
            count = 0
            page += 1
            if "statuses" in data:
                for status in data["statuses"]:
                    if known_context(status["context"]) and status["context"] not in result:
                        result[status["context"]] = status
                count = len(data["statuses"])
        return result

    def pulls(self, state='open', since=None):
        result = [ ]
        page = 1
        count = 100
        while count == 100:
            pulls = self.get("pulls?page={0}&per_page={1}&state={2}&sort=created&direction=desc".format(page, count, state))
            count = 0
            page += 1
            for pull in pulls or []:
                # Check that the pulls are past the expected date
                if since:
                    closed = pull.get("closed_at", None)
                    if closed and since > time.mktime(time.strptime(closed, "%Y-%m-%dT%H:%M:%SZ")):
                        continue
                    created = pull.get("created_at", None)
                    if not closed and created and since > time.mktime(time.strptime(created, "%Y-%m-%dT%H:%M:%SZ")):
                        continue

                result.append(pull)
                count += 1
        return result

    # The since argument is seconds since the issue was either
    # created (for open issues) or closed (for closed issues)
    def issues(self, labels=[ "bot" ], state="open", since=None):
        result = [ ]
        page = 1
        count = 100
        opened = True
        label = ",".join(labels)
        while count == 100 and opened:
            req = "issues?labels={0}&state=all&page={1}&per_page={2}".format(label, page, count)
            issues = self.get(req)
            count = 0
            page += 1
            opened = False
            for issue in issues:
                count += 1

                # On each loop of 100 issues we must encounter at least 1 open issue
                if issue["state"] == "open":
                    opened = True

                # Make sure the state matches
                if state != "all" and issue["state"] != state:
                    continue

                # Check that the issues are past the expected date
                if since:
                    closed = issue.get("closed_at", None)
                    if closed and since > time.mktime(time.strptime(closed, "%Y-%m-%dT%H:%M:%SZ")):
                        continue
                    created = issue.get("created_at", None)
                    if not closed and created and since > time.mktime(time.strptime(created, "%Y-%m-%dT%H:%M:%SZ")):
                        continue

                result.append(issue)
        return result

    def commits(self, branch='master', since=None):
        page = 1
        count = 100
        if since:
            since = "&since={0}".format(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(since)))
        else:
            since = ""
        while count == 100:
            commits = self.get("commits?page={0}&per_page={1}&sha={2}{3}".format(page, count, branch, since))
            count = 0
            page += 1
            for commit in commits or []:
                yield commit
                count += 1

    def whitelist(self):
        users = set()
        teamId = self.teamIdFromName(TEAM_CONTRIBUTORS)
        page = 1
        count = 100
        while count == 100:
            data = self.get("/teams/{0}/members?page={1}&per_page={2}".format(teamId, page, count)) or []
            users.update(user.get("login") for user in data)
            count = len(data)
            page += 1
        return users

    def teamIdFromName(self, name):
        for team in self.get("/orgs/cockpit-project/teams") or []:
            if team.get("name") == name:
                return team["id"]
        else:
            raise KeyError("Team {0} not found".format(name))


class Checklist(object):
    def __init__(self, body=None):
        self.process(body or "")

    @staticmethod
    def format_line(item, check):
        status = ""
        if isinstance(check, str):
            status = check + ": "
            check = False
        return " * [{0}] {1}{2}".format(check and "x" or " ", status, item)

    @staticmethod
    def parse_line(line):
        check = item = None
        stripped = line.strip()
        if stripped[:6] in ["* [ ] ", "- [ ] ", "* [x] ", "- [x] ", "* [X] ", "- [X] "]:
            status, unused, item = stripped[6:].strip().partition(": ")
            if not item:
                item = status
                status = None
            if status:
                check = status
            else:
                check = stripped[3] in ["x", "X"]
        return (item, check)

    def process(self, body, items={ }):
        self.items = { }
        lines = [ ]
        items = items.copy()
        for line in body.splitlines():
            (item, check) = self.parse_line(line)
            if item:
                if item in items:
                    check = items[item]
                    del items[item]
                    line = self.format_line(item, check)
                self.items[item] = check
            lines.append(line)
        for item, check in items.items():
            lines.append(self.format_line(item, check))
            self.items[item] = check
        self.body = "\n".join(lines)

    def check(self, item, checked=True):
        self.process(self.body, { item: checked })

    def add(self, item):
        self.process(self.body, { item: False })
