
import argparse
import errno
import httplib
import json
import urllib
import os
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

OS = os.environ.get("TEST_OS", "fedora-22")
ARCH = os.environ.get("TEST_ARCH", "x86_64")
HOSTNAME = socket.gethostname().split(".")[0]

TESTING = "Testing in progress"
NOT_TESTED = "Not yet tested"

__all__ = (
    'Sink',
    'GitHub',
    'arg_parser',
    'OS',
    'ARCH',
    'TESTING'
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

    def context(self):
        return OS + "/" + ARCH

    def qualify(self, resource):
        return urlparse.urljoin(self.base, resource)

    def request(self, method, resource, data="", headers=None):
        if headers is None:
            headers = { }
        headers["User-Agent"] = "Cockpit Tests"
        if self.token:
            headers["Authorization"] = "token " + self.token
        if not self.conn:
            self.conn = httplib.HTTPSConnection("api.github.com", strict=True)
        self.conn.set_debuglevel(self.debug and 1 or 0)
        self.conn.request(method, self.qualify(resource), data, headers)
        response = self.conn.getresponse()
        output = response.read()
        if method == "GET" and response.status == 404:
            return ""
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

    def status(self, revision):
        statuses = self.get("commits/{0}/statuses".format(revision))
        if statuses:
            for status in statuses:
                if status["context"] == self.context():
                    return status
        return { }

    def prioritize(self, revision, labels=[], update=None, baseline=10):
        last = self.status(revision)
        state = last.get("state", None)

        priority = baseline

        # This commit definitively succeeds or fails
        if state in [ "success", "failure" ]:
            return 0

        # This test errored, we try again but low priority
        elif state in [ "error" ]:
            update = None
            priority = 4

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
            if last.get("description", "").startswith(TESTING):
                update = None
                priority = 0

        if update and priority <= 0:
            update = update.copy()
            update["description"] = "Manual testing required"

        if update and not dict_is_subset(last, update):
            self.post("statuses/" + revision, update)

        return priority

    def scan(self, update=False):
        pulls = []

        whitelist = read_whitelist()

        results = []

        if update:
            status = { "state": "pending", "description": NOT_TESTED, "context": self.context() }
        else:
            status = None

        master = self.get("git/refs/heads/master")
        priority = self.prioritize(master["object"]["sha"], update=status, baseline=9)
        if priority > 0:
            results.append((priority, "master", master["object"]["sha"], "master"))

        # Load all the pull requests
        for pull in self.get("pulls"):
            baseline = 10

            # It needs to be in the whitelist
            login = pull["head"]["user"]["login"]
            if login not in whitelist:
                if status:
                    status["description"] = "Manual testing required"
                baseline = 0

            # Pull in the labels for this pull
            labels = []
            for label in self.get("issues/{0}/labels".format(pull["number"])):
                labels.append(label["name"])

            number = pull["number"]
            revision = pull["head"]["sha"]

            priority = self.prioritize(revision, labels, update=status, baseline=baseline)
            if priority > 0:
                results.append((priority, "pull-%d" % number, revision, "pull/%d/head" % number))

        results.sort(key=lambda v: v[0], reverse=True)
        return results

    def trigger(self, pull_number, force = False):
        sys.stderr.write("triggering pull {0} for context {1}\n".format(pull_number, self.context()))
        pull = self.get("pulls/" + pull_number)

        # triggering is manual, so don't prevent triggering a user that isn't on the whitelist
        # but issue a warning in case of an oversight
        whitelist = read_whitelist()
        login = pull["head"]["user"]["login"]
        if login not in whitelist:
            sys.stderr.write("warning: pull request author '{0}' isn't in github-whitelist.\n".format(login))

        revision = pull['head']['sha']
        current_status = self.status(revision)
        if current_status.get("state", "empty") not in ["empty", "error", "failure"]:
            if force:
                sys.stderr.write("Pull request isn't in error state, but forcing update.\n")
            else:
                sys.stderr.write("Pull request isn't in error state, not triggering test. Status is: '{0}'\n".format(current_status["state"]))
                return

        status = { "state": "pending", "description": NOT_TESTED, "context": self.context() }
        self.post("statuses/" + revision, status)

if __name__ == '__main__':
    github = GitHub("/repos/cockpit-project/cockpit/")
    for (priority, name, revision, ref) in github.scan(True):
        sys.stdout.write("{0}: {1} ({2})\n".format(name, revision, priority))
