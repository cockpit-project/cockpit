#!/usr/bin/env python
# -*- coding: utf-8 -*-

# This file is part of Cockpit.
#
# Copyright (C) 2017 Red Hat, Inc.
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

import argparse
import os
import random
import re
import shlex
import socket
import subprocess
import sys
import time
import traceback

sys.dont_write_bytecode = True

import github
import sink

__all__ = (
    "main",
    "run",
    "pull",
    "issue",
)

api = github.GitHub()

BOTS = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
BASE = os.path.normpath(os.path.join(BOTS, ".."))

#
# The main function takes a list of tasks, each of wihch has the following
# fields, some of which have defaults:
#
#   title: The title for the task
#   function: The function to call for the task
#   options=[]: A list of string options to pass to the function argument
#
# The function for the task will be called with all the context for the task.
# In addition it will be called with named arguments for all other task fields
# and additional fields such as |verbose|. It should return a zero or None value
# if successful, and a string or non-zero value if unsuccessful.
#
#   def run(context, verbose=False, **kwargs):
#       if verbose:
#           sys.stderr.write(image + "\n")
#       return 0
#
# Call the task.main() as the entry point of your script in one of these ways:
#
#   # As a single task
#   task.main(title="My title", function=run)
#

def main(**kwargs):
    global verbose

    task = kwargs.copy()

    # Figure out a descriptoin for the --help
    if "name" not in task:
        task["name"] = os.path.basename(os.path.realpath(sys.argv[0]))

    parser = argparse.ArgumentParser(description=task.get("title", task["name"]))
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")
    parser.add_argument("--issue", dest="issue", action="store",
        help="Act on an already created task issue")
    parser.add_argument("--publish", dest="publish", default=os.environ.get("TEST_PUBLISH", ""),
        action="store", help="Publish results centrally to a sink")
    parser.add_argument("context", nargs="?")

    opts = parser.parse_args()
    verbose = opts.verbose

    ret = 0

    if "verbose" not in task:
        task["verbose"] = opts.verbose
    task["issue"] = opts.issue
    task["publish"] = opts.publish

    ret = run(opts.context, task)

    if ret:
        sys.stderr.write("{0}: {1}\n".format(task["name"], ret))

    sys.exit(ret and 1 or 0)

def begin(name, title, publish, issue):
    if not publish:
        return None

    current = time.strftime('%Y%m%d-%H%M%M')
    if issue:
        identifier = "{0}-{1}-{2}".format(name, issue, current)
    else:
        identifier = "{0}-{1}".format(name, current)

    hostname = socket.gethostname().split(".")[0]

    # Update the body for an existing issue
    if issue:
        body = "{0}\n{1} on {2}".format(title, PROGRESS, hostname)
        requests = [ {
            "method": "POST",
            "resource": api.qualify("issues/" + issue),
            "data": { "body": body }
        }, {
            "method": "POST",
            "resource": api.qualify("issues/" + issue + "/comments"),
            "data": { "body": "Log: :link" }
        } ]
        watches = [ {
            "resource": api.qualify("issues/" + issue),
            "result": { "body": body }
        } ]
        aborted = [ {
            "method": "POST",
            "resource": api.qualify("issues/" + issue + "/comments"),
            "data": { "body": "Task aborted." }
        } ]
    else:
        requests = [ ]
        watches = [ ]
        aborted = [ ]

    status = {
        "github": {
            "token": api.token,
            "requests": requests,
            "watches": watches
        },

        "onaborted": {
            "github": {
                "token": api.token,
                "requests": aborted
            }
        }
    }

    return sink.Sink(publish, identifier, status)

def finish(publishing, ret, issue):
    if not publishing:
        return

    if ret == 0:
        comment = "Task completed: :link"
    elif isinstance(ret, basestring):
        comment = "{0}: :link".format(ret)
    else:
        comment = "Task failed: :link"

    if issue:
        requests = [ {
            "method": "POST",
                "resource": api.qualify("issues/" + issue + "/comments"),
                "data": { "body": comment }
            }
        ]
    else:
        requests = [ ]

    publishing.status['github']['requests'] = requests
    publishing.flush()

def run(context, **kwargs):
    issue = kwargs.get("issue", None)
    publishing = begin(kwargs["name"], kwargs["title"], publish, issue=issue)
    ret = "Task threw an exception"
    try:
        ret = function(context, **kwargs)
    except (RuntimeError, subprocess.CalledProcessError), ex:
        ret = str(ex)
    except:
        traceback.print_exc(file=sys.stderr)
    finally:
        finish(publishing, ret, issue)
    return ret or 0

def stale(days, pathspec):
    global verbose

    def execute(*args):
        if verbose:
            sys.stderr.write("+ " + " ".join(args) + "\n")
        return subprocess.check_output(args, cwd=BASE)

    timestamp = execute("git", "log", "--max-count=1", "--pretty=format:%at", pathspec)
    if not timestamp:
        timestamp = 0

    # We randomize when we think this should happen over a day
    now = time.time() + random.randint(-43200, 43200)

    return timestamp < now

def issue(title, body, name, context):
    for issue in api.issues(state="open"):
        if issue["title"].endswith(title):
            return issue

    item = "{0} {1}".format(name, context or "")
    checklist = github.Checklist(body)
    checklist.add(item)

    data = {
        "title": title,
        "body": checklist.body,
        "labels": [ "bot" ]
    }

    return api.post(resource="issues", data)

def pull(branch, message, issue=None, pathspec="."):
    global verbose

    # Github wants the OAuth token as the username and git will
    # happily echo that back out.  So we censor all output.
    user = api.get("/user")['login']
    censor = api.token

    def execute(*args):
        if verbose:
            sys.stderr.write("+ " + " ".join(args) + "\n")
        subprocess.check_call(args, cwd=BASE)

    url = "https://{0}@github.com/{1}/cockpit.git".format(api.token, user)

    exceute("git", "checkout", "--detach")
    execute("git", "commit", "-a", pathspec, "-m", message)
    execute("git", "push", url, "+HEAD:refs/heads/{0}".format(branch))

    data = {
        "head": "{0}::{1}".format(user, branch),
        "base": "master"
    }

    if issue:
        if isinstance(issue, dict):
            data["issue"] = issue["number"]
        else
            data["issue"] = issue

    return api.post("pulls", data)

# Polyfill for missing arparse functionality in python 2.x
# https://stackoverflow.com/questions/6365601/default-sub-command-or-handling-no-sub-command-with-argparse
def set_default_subparser(self, name, args=None):
    subparser_found = False
    for arg in sys.argv[1:]:
        if arg in ["-h", "--help"]:
            break
    else:
        for x in self._subparsers._actions:
            if not isinstance(x, argparse._SubParsersAction):
                continue
            for sp_name in x._name_parser_map.keys():
                if sp_name in sys.argv[1:]:
                    subparser_found = True
        if not subparser_found:
            if args is None:
                sys.argv.insert(1, name)
            else:
                args.insert(0, name)

argparse.ArgumentParser.set_default_subparser = set_default_subparser
