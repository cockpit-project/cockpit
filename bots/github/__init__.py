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

# Shared GitHub code. When run as a script, we print out info about
# our GitHub interacition.

import errno
import httplib
import json
import os
import re
import subprocess
import sys
import urlparse

import cache

__all__ = (
    'GitHub',
    'TESTING',
    'NO_TESTING',
    'NOT_TESTED',
    'ISSUE_TITLE_IMAGE_REFRESH'
)

TESTING = "Testing in progress"
NOT_TESTED = "Not yet tested"
NO_TESTING = "Manual testing required"

ISSUE_TITLE_IMAGE_REFRESH = "Image refresh for {0}"

BOTS = os.path.join(os.path.dirname(__file__), "..")
TOKEN = "~/.config/github-token"

# the user name is accepted if it's found in either list
WHITELIST = os.path.join(BOTS, "github", "whitelist")
WHITELIST_LOCAL = "~/.config/github-whitelist"

def determine_github_base():
    # pick a base
    try:
        # see where we get master from, e.g. origin
        get_remote_command = ["git", "config", "--local", "--get", "branch.master.remote"]
        remote = subprocess.Popen(get_remote_command, stdout=subprocess.PIPE, cwd=BOTS).communicate()[0].strip()
        # see if we have a git checkout - it can be in https or ssh format
        formats = [
            re.compile("""https:\/\/github\.com\/(.*)\.git"""),
            re.compile("""git@github.com:(.*)\.git""")
            ]
        remote_output = subprocess.Popen(
                ["git", "ls-remote", "--get-url", remote],
                stdout=subprocess.PIPE, cwd=BOTS
            ).communicate()[0].strip()
        for f in formats:
            m = f.match(remote_output)
            if m:
                return list(m.groups())[0]
    except subprocess.CalledProcessError:
        sys.stderr.write("Unable to get git repo information, using defaults\n")

    # if we still don't have something, default to cockpit-project/cockpit
    return "cockpit-project/cockpit"

# github base to use
GITHUB_BASE = "/repos/{0}/".format(os.environ.get("GITHUB_BASE", determine_github_base()))

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

class GitHub(object):
    def __init__(self, base=GITHUB_BASE):
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

        # The cache directory is $TEST_DATA/github bots/github
        directory = os.path.join(os.environ.get("TEST_DATA", BOTS), "github")
        self.cache = cache.Cache(directory)

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

    def get(self, resource):
        headers = { }
        qualified = self.qualify(resource)
        cached = self.cache.read(qualified)
        if cached:
            if self.cache.current(qualified):
                return cached
            etag = cached['headers'].get("etag", None)
            if etag:
                headers['If-None-Match'] = etag
        response = self.request("GET", resource, "", headers)
        if response['status'] == 404:
            return None
        elif cached and response['status'] == 304: # Not modified
            self.cache.write(resource, response)
            return json.loads(cached['data'])
        elif response['status'] < 200 or response['status'] >= 300:
            sys.stderr.write("{0}\n{1}\n".format(resource, response['data']))
            raise Exception("GitHub API problem: {0}".format(response['reason'] or response['status']))
        else:
            self.cache.write(resource, response)
            return json.loads(response['data'])

    def post(self, resource, data, accept=[]):
        response = self.request("POST", resource, json.dumps(data), { "Content-Type": "application/json" })
        self.cache.mark()
        status = response['status']
        if (status < 200 or status >= 300) and status not in accept:
            sys.stderr.write("{0}\n{1}\n".format(resource, response['data']))
            raise Exception("GitHub API problem: {0}".format(response['reason'] or status))
        return json.loads(response['data'])

    def patch(self, resource, data, accept=[]):
        response = self.request("PATCH", resource, json.dumps(data), { "Content-Type": "application/json" })
        self.cache.mark()
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

    def pulls(self):
        result = [ ]
        page = 1
        count = 100
        while count == 100:
            pulls = self.get("pulls?page={0}&per_page={1}".format(page, count))
            count = 0
            page += 1
            if pulls:
                result += pulls
                count = len(pulls)
        return result

    def labels(self, issue):
        result = [ ]
        for label in self.get("issues/{0}/labels".format(issue)):
            result.append(label["name"])
        return result
