import os
import subprocess
import sys
import time

import testinfra

class GithubImageTask(object):
    def __init__(self, name, image, config):
        self.name = name
        self.image = image
        self.config = config
        self.sink = None

    def description(self):
        return self.name

    def start_publishing(self, host, github):
        identifier = self.name + "-" + time.strftime("%Y-%m-%d")
        status = {
            "github": {
                "token": github.token,
                "requests": [
                    # Create issue
                    { "method": "POST",
                      "resource": github.qualify("issues"),
                      "data": {
                          "title": testinfra.ISSUE_TITLE_IMAGE_REFRESH.format(self.image),
                          "labels": [ "bot" ],
                          "body": ("Image creation for %s in process on %s.\nLog: :link"
                                   % (self.image, testinfra.HOSTNAME))
                      },
                      "result": "issue"
                    }
                ]
            },

            "onaborted": {
                "github": {
                    "token": github.token,
                    "requests": [
                        # Post comment about failure
                        { "method": "POST",
                          "resource": ":issue.comments_url",
                          "data": {
                              "body": "Image creation aborted",
                          }
                        }
                    ]
                },
            }
        }
        self.sink = testinfra.Sink(host, identifier, status)

    def check_publishing(self, github):
        # If the most recently created issue for our image does not
        # mention our host, we have been overtaken and should stop.

        expected_title = testinfra.ISSUE_TITLE_IMAGE_REFRESH.format(self.image)
        expected_description = "Image creation for %s in process on %s." % (self.image, testinfra.HOSTNAME)

        issues = github.get("issues?labels=bot&filter=all&state=all")
        for issue in issues:
            if issue['title'] == expected_title:
                return issue['body'].startswith(expected_description)
        return True

    def stop_publishing(self, github, ret, branch):
        if ret is None:
            message = "Image creation stopped to avoid conflict."
        else:
            if ret == 0:
                message = "Image creation done."
            else:
                message = "Image creation failed."
            if not branch:
                message += "\nBranch creation failed."

        requests = [
            # Post comment
            { "method": "POST",
              "resource": ":issue.comments_url",
              "data": {
                  "body": message
              }
            }
        ]

        if branch:
            requests += [
                # Turn issue into pull request
                { "method": "POST",
                  "resource": github.qualify("pulls"),
                  "data": {
                      "issue": ":issue.number",
                      "head": branch,
                      "base": "master"
                  },
                  "result": "pull"
                }
            ]

            for t in self.config.get("triggers", [ ]):
                requests += [
                    # Trigger testing
                    { "method": "POST",
                      "resource": github.qualify("statuses/:pull.head.sha"),
                      "data": {
                          "state": "pending",
                          "context": t,
                          "description": testinfra.NOT_TESTED
                      }
                    }
                ]


        self.sink.status['github']['requests'] = requests
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

        def check():
            if not self.check_publishing(github):
                self.overtaken = True
                return False
            return True

        cmd = [ "./vm-create", "--verbose", "--upload" ]
        if self.config.store:
            cmd += [ "--store", self.config.store ]
        cmd += [ self.image ]

        print cmd

        proc = subprocess.Popen(cmd)
        self.overtaken = False
        ret = testinfra.wait_testing(proc, check)

        if self.overtaken:
            if self.sink:
                self.stop_publishing(github, None, None)
            return

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

        branch = "refresh-" + self.image + "-" + time.strftime("%Y-%m-%d")
        url = "https://{0}@github.com/{1}/cockpit.git".format(github.token, user)

        # When image creation fails, remove the link and make a pull
        # request anyway, for extra attention

        if ret != 0:
            os.unlink("images/" + self.image)

        have_branch = (run_censored([ "git", "checkout", "--detach" ]) and
                       run_censored([ "git", "commit", "-a",
                                      "-m", testinfra.ISSUE_TITLE_IMAGE_REFRESH.format(self.image) ]) and
                       run_censored([ "git", "push", url, "+HEAD:refs/heads/" + branch ]))

        if self.sink:
            self.stop_publishing(github, ret, (user + "::" + branch) if have_branch else None)
