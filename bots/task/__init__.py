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
    "scan",
    "run",
    "pull",
)

api = github.GitHub()
issues = None
verbose = False

PROGRESS = " * [x] Processing"
BASE = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))

#
# The main function takes a list of tasks, each of wihch has the following
# fields, some of which have defaults:
#
#   title: The title for the task
#   function: The function to call for the task
#   options=[]: A list of string options to pass to the function argument
#   days=7: Number of days after which to perform the task
#   priority=5: Numeric priority of the task
#
# The function for the task will be called with all the options in the task.
# In addition it will be called with named arguments for all other task fields
# and additional fields such as |verbose|. It should return a zero or None value
# if successful, and a string or non-zero value if unsuccessful.
#
#   def run(image, verbose=False, **kwargs):
#       if verbose:
#           sys.stderr.write(image + "\n")
#       return 0
#
# Call the task.main() as the entry point of your script in one of these ways:
#
#   # As a single task
#   task.main(title="My title", days=5, options=[ "image" ], function=run)
#
#   # As a single task in a dict
#   task.main({ "title": "My title", "days": 5, "function": run, "options": [ "image" ] })
#
#   # With a list of tasks
#   task.main([ { "title": "My title", "days": 5 }, { "title": "Second task", "days": 3 } ])
#

def main(*args, **kwargs):
    global verbose

    # Called with a task as named arguments
    if len(args) == 0 and len(kwargs) > 0:
        tasks = [ kwargs ]
    elif len(args) == 1 and len(kwargs) == 0:
        # A single task was passed in
        if not hasattr(tasks, "__iter__"):
            tasks = [ args[0] ]
        # A list of tasks was passed in
        else:
            tasks = args[0]
    else:
        assert False, "Invalid parameters to task.main()"

    # Figure out a descriptoin for the --help
    description = os.path.basename(sys.argv[0])
    if len(tasks):
        description = tasks[0].get("description", description)

    parser = argparse.ArgumentParser(description=description)

    # Scan argumenst
    subparsers = parser.add_subparsers(help="sub-command help")
    scanner = subparsers.add_parser("scan", help="scan help")
    scanner.add_argument("-v", "--human-readable", "--verbose", action="store_true", default=False,
         dest="verbose", help="Print verbose information")
    scanner.set_defaults(mode="scan")

    # Run arguments
    runner = subparsers.add_parser("run", help="run help")
    runner.add_argument("-v", "--verbose", action="store_true", help="Verbose output")
    runner.add_argument("--issue", dest="issue", action="store",
        help="Act on an already created task issue")
    runner.add_argument("--publish", dest="publish", default=os.environ.get("TEST_PUBLISH", ""),
        action="store", help="Publish results centrally to a sink")
    runner.add_argument("options", nargs="*")
    runner.set_defaults(mode="run")

    # Choose either scan or run as a default
    if sys.argv[0].endswith("-scan"):
        parser.set_default_subparser("scan")
    else:
        parser.set_default_subparser("run")

    opts = parser.parse_args()
    verbose = opts.verbose

    results = [ ]
    ret = 0

    for task in tasks:
        task["verbose"] = opts.verbose or task.get("verbose", False)
        task["name"] = task.get("name", os.path.basename(sys.argv[0]))
        if opts.mode == "scan":
            result = scan(**task)
            if result is not None:
                results.append(result)
        else:
            if opts.options == task.get("options", [ ]):
                task["publish"] = opts.publish
                task["issue"] = opts.issue
                ret = run(**task)
                if ret:
                    break

    for result in results:
        if result:
            sys.stdout.write(result + "\n")
    if ret:
        name = os.path.basename(sys.argv[0])
        sys.stderr.write("{0}: {1}\n".format(name, ret))

    sys.exit(ret and 1 or 0)

# Default scan behavior run for each task
def scan(name, title, days=7, priority=5, **kwargs):
    global issues
    if issues is None:
        issues = api.issues()
    for issue in issues:
        if issue.get("title", None) == title:
            break
    else:
        issue = { }

    state = issue.get("state", "invalid")

    # If we we have the "In progress" message in the last line
    if state == "open":
        if PROGRESS in issue["body"]:
            issue = None

    # See if we should create a new message
    else:
        when = 0
        if "created_at" in issue:
            when = time.mktime(time.strptime(issue["created_at"], "%Y-%m-%dT%H:%M:%SZ"))
        # We randomize when we think this should happen over a day
        now = time.time() + random.randint(-43200, 43200)
        # Create issue for this task
        if when < now:
            body = kwargs.get("body", title)
            issue = api.post(resource="issues", data={
                "title": title,
                "labels": [ "bot" ],
                "body": body
            })

    number = issue.get("number", None)
    if number is None:
        return None

    cmd = os.path.realpath(sys.argv[0])

    if kwargs.get("verbose", False):
        return "issue-{issue} {cmd}     {priority}".format(
            issue=int(number),
            priority=int(priority),
            cmd=os.path.basename(cmd)
        )
    else:
        base = os.path.abspath(BASE)
        relpath = os.path.relpath(cmd, base)
        return "PRIORITY={priority:04d} {cmd} --issue='{issue}'".format(
            issue=int(number),
            priority=int(priority),
            cmd=relpath
        )

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

def run(function, options=[], publish="", issue=None, **kwargs):
    publishing = begin(kwargs["name"], kwargs["title"], publish, issue=issue)
    ret = "Task threw an exception"
    try:
        ret = function(*options, **kwargs)
    except (RuntimeError, subprocess.CalledProcessError), ex:
        ret = str(ex)
    except:
        traceback.print_exc(file=sys.stderr)
    finally:
        finish(publishing, ret, issue)
    return ret

def pull(branch, message, issue=None, pathspec="."):
    global verbose

    # Github wants the OAuth token as the username and git will
    # happily echo that back out.  So we censor all output.
    user = api.get("/user")['login']
    censor = api.token

    def execute(*args):
        if verbose:
            sys.stderr.write("+ " + " ".join(args) + "\n")
        subprocess.check_output(args)

    url = "https://{0}@github.com/{1}/cockpit.git".format(api.token, user)

    exceute("git", "checkout", "--detach")
    execute("git", "commit", "-a", pathspec, "-m", message)
    execute("git", "push", url, "+HEAD:refs/heads/{0}".format(branch))

    data = {
        "head": "{0}::{1}".format(user, branch),
        "base": "master"
    }

    if issue:
        data["issue"] = issue
    api.post("pulls", data)

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
