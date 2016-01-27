import subprocess
import sys

import testinfra

class GithubImageTask(object):
    def __init__(self, name, image):
        self.name = name
        self.image = image
        self.sink = None

    def description(self):
        return self.name

    def start_publishing(self, host, github):
        identifier = self.name
        status = {
            "github": {
                "token": github.token,
                "resource": github.base,
                "message": "Image creation in progress",
                "issue": {
                    "title": testinfra.ISSUE_TITLE_IMAGE_REFRESH.format(self.image),
                    "labels": [ "bot" ]
                }
            }
        }
        self.sink = testinfra.Sink(host, identifier, status)

    def check_publishing(self, github):
        return True

    def stop_publishing(self, ret, branch):
        if ret == 0:
            message = "Image creation done"
            if branch:
                self.sink.status['github']['pull'] = { 'head': branch,
                                                       'base': "master" }
        else:
            message = "Image creation failed"
        self.sink.status['github']['message'] = message
        self.sink.flush()

    def run(self, opts, github):

        if not github.token:
            print "Need a github token to run image creation tasks"
            return

        if opts.publish:
            self.start_publishing(opts.publish, github)

        user = github.get("/user")['login']

        msg = "Creating image {0} on {1}...\n".format(self.image, testinfra.HOSTNAME)
        sys.stderr.write(msg)

        # proc = subprocess.Popen([ "./vm-create", "--verbose", "--upload", self.image ])
        proc = subprocess.Popen([ "ln", "-sf", "TEST", "images/" + self.image ])
        ret = testinfra.wait_testing(proc, lambda: self.check_publishing(github))

        # Github wants the OAuth token as the username and git will
        # happily echo that back out.  So we censor all output.

        def run_censored(cmd):

            def censored(text):
                return text.replace(github.token, "CENSORED")

            try:
                output = subprocess.check_output(cmd, stderr=subprocess.STDOUT)
                print censored(output)
                return True
            except subprocess.CalledProcessError as e:
                print censored(e.output)
                print "Failed:", censored(' '.join(e.cmd))
                return False

        # Push the new image link to origin, but don't change any local refs

        branch = "refresh-" + self.image
        url = "https://{0}@github.com/{1}/cockpit.git".format(github.token, user)

        if ret == 0:
            if (run_censored([ "git", "checkout", "--detach" ]) and
                run_censored([ "git", "commit", "-a", "-m", "Refreshed {0} image".format(self.image) ]) and
                run_censored([ "git", "push", url, "+HEAD:refs/heads/" + branch ])):
                pass
            else:
                ret = 1

        if self.sink:
            self.stop_publishing(ret, user + ":" + branch)
