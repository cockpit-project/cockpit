#!/usr/bin/python3
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
import shutil
import socket
import subprocess
import sys
import time
import traceback

sys.dont_write_bytecode = True

from . import github
from . import sink

__all__ = (
    "api",
    "main",
    "run",
    "pull",
    "comment",
    "label",
    "issue",
    "verbose",
    "stale",
    "REDHAT_PING",
)

# Server to tell us if we can handle Red Hat images
REDHAT_PING = "http://cockpit-11.e2e.bos.redhat.com"

api = github.GitHub()
verbose = False

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
    task["name"] = named(task)

    parser = argparse.ArgumentParser(description=task.get("title", task["name"]))
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")
    parser.add_argument("--issue", dest="issue", action="store",
        help="Act on an already created task issue")
    parser.add_argument("--publish", dest="publish", default=os.environ.get("TEST_PUBLISH", ""),
        action="store", help="Publish results centrally to a sink")
    parser.add_argument("--dry", dest="dry", action="store_true",
        help="Dry run to validate this task if supported")
    parser.add_argument("context", nargs="?")

    opts = parser.parse_args()
    verbose = opts.verbose

    ret = 0

    if "verbose" not in task:
        task["verbose"] = opts.verbose
    task["issue"] = opts.issue
    task["publish"] = opts.publish
    task["dry"] = opts.dry

    ret = run(opts.context, **task)

    if ret:
        sys.stderr.write("{0}: {1}\n".format(task["name"], ret))

    sys.exit(ret and 1 or 0)

def named(task):
    if "name" in task:
        return task["name"]
    else:
        return os.path.basename(os.path.realpath(sys.argv[0]))

def begin(publish, name, context, issue):
    if not publish:
        return None

    hostname = socket.gethostname().split(".")[0]
    current = time.strftime('%Y%m%d-%H%M%M')

    # Update the body for an existing issue
    if issue:
        number = issue["number"]
        identifier = "{0}-{1}-{2}".format(name, number, current)
        title = issue["title"]
        wip = "WIP: {0}: {1}".format(hostname, title)
        requests = [ {
            "method": "POST",
            "resource": api.qualify("issues/{0}".format(number)),
            "data": { "title": wip }
        }, {
            "method": "POST",
            "resource": api.qualify("issues/{0}/comments".format(number)),
            "data": { "body": "{0} in progress on {1}.\nLog: :link".format(name, hostname) }
        } ]
        watches = [ {
            "resource": api.qualify("issues/{0}".format(number)),
            "result": { "title": wip }
        } ]
        aborted = [ {
            "method": "POST",
            "resource": api.qualify("issues/{0}".format(number)),
            "data": { "title": title }
        }, {
            "method": "POST",
            "resource": api.qualify("issues/{0}/comments".format(number)),
            "data": { "body": "Task aborted." }
        } ]
    else:
        identifier = "{0}-{1}".format(name, current)
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

    publishing = sink.Sink(publish, identifier, status)
    sys.stdout.write("# Task: {0} {1}\n# Host: {2}\n\n".format(name, context or "", hostname))

    # For statistics
    publishing.start = time.time()

    return publishing

def finish(publishing, ret, name, context, issue):
    if not publishing:
        return

    if not ret:
        comment = None
        result = "Completed"
    elif isinstance(ret, str):
        comment = "{0}: :link".format(ret)
        result = ret
    else:
        comment = "Task failed: :link"
        result = "Failed"

    duration = int(time.time() - publishing.start)
    sys.stdout.write("\n# Result: {0}\n# Duration: {1}s\n".format(result, duration))

    if issue:
        # Note that we check whether pass or fail ... this is because
        # the task is considered "done" until a human comes through and
        # triggers it again by unchecking the box.
        item = "{0} {1}".format(name, context or "").strip()
        checklist = github.Checklist(issue["body"])
        checklist.check(item, ret and "FAIL" or True)

        number = issue["number"]
        requests = [ {
            "method": "POST",
            "resource": api.qualify("issues/{0}".format(number)),
            "data": { "title": issue["title"], "body": checklist.body }
        } ]

        # Close the issue if it's not a pull request, successful, and only one task to do
        if "pull_request" not in issue and not ret and len(checklist.items) == 1:
            requests[0]["data"]["state"] = "closed"

        # Comment if there was a failure
        if comment:
            requests.insert(0, {
                "method": "POST",
                "resource": api.qualify("issues/{0}/comments".format(number)),
                "data": { "body": comment }
            })

    else:
        requests = [ ]

    publishing.status['github']['requests'] = requests
    publishing.status['github']['watches'] = None
    publishing.status['github']['onaborted'] = None
    publishing.flush()

def run(context, function, **kwargs):
    number = kwargs.get("issue", None)
    publish = kwargs.get("publish", "")
    name = kwargs["name"]

    issue = None
    if number:
        issue = api.get("issues/{0}".format(number))
        if not issue:
            return "No such issue: {0}".format(number)
        elif issue["title"].startswith("WIP:"):
            return "Issue is work in progress: {0}: {1}\n".format(number, issue["title"])
        kwargs["issue"] = issue
        kwargs["title"] = issue["title"]

    publishing = begin(publish, name, context, issue=issue)

    ret = "Task threw an exception"
    try:
        if issue and "pull_request" in issue:
           kwargs["pull"] = api.get(issue["pull_request"]["url"])

        ret = function(context, **kwargs)
    except (RuntimeError, subprocess.CalledProcessError) as ex:
        ret = str(ex)
    except (AssertionError, KeyboardInterrupt):
        raise
    except:
        traceback.print_exc()
    finally:
        finish(publishing, ret, name, context, issue)
    return ret or 0

# Check if the given files that match @pathspec are stale
# and haven't been updated in @days.
def stale(days, pathspec, ref="HEAD"):
    global verbose

    def execute(*args):
        if verbose:
            sys.stderr.write("+ " + " ".join(args) + "\n")
        output = subprocess.check_output(args, cwd=BASE, universal_newlines=True)
        if verbose:
            sys.stderr.write("> " + output + "\n")
        return output

    timestamp = execute("git", "log", "--max-count=1", "--pretty=format:%ct", ref, "--", pathspec)
    try:
        timestamp = int(timestamp)
    except ValueError:
        timestamp = 0

    # We randomize when we think this should happen over a day
    offset = days * 86400
    due = time.time() - random.randint(offset - 43200, offset + 43200)

    return timestamp < due

def issue(title, body, name, context=None, state="open", since=None):
    item = "{0} {1}".format(name, context or "").strip()

    for issue in api.issues(state=state, since=since):
        checklist = github.Checklist(issue["body"])
        if item in checklist.items:
            return issue

    checklist = github.Checklist(body)
    checklist.add(item)
    data = {
        "title": title,
        "body": checklist.body,
        "labels": [ "bot" ]
    }
    return api.post("issues", data)

def execute(*args):
    global verbose
    if verbose:
        sys.stderr.write("+ " + " ".join(args) + "\n")

    # Make double sure that the token does not appear anywhere in the output
    def censored(text):
        return text.replace(api.token, "CENSORED")

    env = os.environ.copy()
    # No prompting for passwords
    if "GIT_ASKPASS" not in env:
        env["GIT_ASKPASS"] = "/bin/true"
    output = subprocess.check_output(args, cwd=BASE, stderr=subprocess.STDOUT, env=env, universal_newlines=True)
    sys.stderr.write(censored(output))

def branch(context, message, pathspec=".", issue=None, **kwargs):
    current = time.strftime('%Y%m%d-%H%M%M')
    name = named(kwargs)
    branch = "{0} {1} {2}".format(name, context or "", current).strip()
    branch = branch.replace(" ", "-").replace("--", "-")

    # Tell git about our github token as a user name
    try:
        subprocess.check_call(["git", "config", "credential.https://github.com.username", api.token])
    except subprocess.CalledProcessError:
        raise RuntimeError("Couldn't configure git config with our API token")

    user = api.get("/user")['login']
    url = "https://github.com/{0}/cockpit".format(user)
    clean = "https://github.com/{0}/cockpit".format(user)

    if pathspec is not None:
        execute("git", "add", "--", pathspec)
    execute("git", "checkout", "--detach")

    # If there's nothing to add at that pathspec return None
    try:
        execute("git", "commit", "-m", message)
    except subprocess.CalledProcessError:
        return None

    execute("git", "push", url, "+HEAD:refs/heads/{0}".format(branch))

    # Comment on the issue if present
    if issue:
        message = "{0} {1} done: {2}/commits/{3}".format(name, context or "", clean, branch)
        try:
            resource = "issues/{0}/comments".format(issue["number"])
        except TypeError:
            resource = "issues/{0}/comments".format(issue)
        api.post(resource, { "body": message })

    return "{0}:{1}".format(user, branch)

def pull(branch, body=None, issue=None, base="master", labels=['bot'], **kwargs):
    if "pull" in kwargs:
        return kwargs["pull"]

    data = {
        "head": branch,
        "base": base,
        "maintainer_can_modify": True
    }
    if issue:
        try:
            data["issue"] = issue["number"]
        except TypeError:
            data["issue"] = int(issue)
    else:
        data["title"] = kwargs["title"]
        if body:
            data["body"] = body

    pull = api.post("pulls", data, accept=[ 422 ])

    # If we were refused to grant maintainer_can_modify, then try without
    if "errors" in pull:
        if pull["errors"][0]["field"] == "fork_collab":
            data["maintainer_can_modify"] = False
        pull = api.post("pulls", data)

    # Update the pull request
    label(pull, labels)

    # Update the issue if it is a dict
    if issue:
        try:
            issue["title"] = kwargs["title"]
            issue["pull_request"] = { "url": pull["url"] }
        except TypeError:
            pass

    return pull

def label(issue, labels=['bot']):
    try:
        resource = "issues/{0}/labels".format(issue["number"])
    except TypeError:
        resource = "issues/{0}/labels".format(issue)
    return api.post(resource, labels)

def comment(issue, comment):
    try:
        number = issue["number"]
    except TypeError:
        number = issue
    return api.post("issues/{0}/comments".format(number), { "body": comment })

def attach(filename):
    if "TEST_ATTACHMENTS" in os.environ:
        shutil.copy(filename, os.environ["TEST_ATTACHMENTS"])
