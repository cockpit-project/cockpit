import os
import subprocess
import sys
import time

import testinfra

class GithubImageTask(object):
    def __init__(self, name, image, config, issue):
        self.name = name
        self.image = image
        self.config = config
        self.issue = issue
        self.pull = None
        self.sink = None

    def description(self):
        if self.issue:
            return "{} (#{})".format(self.name, self.issue['number'])
        else:
            return self.name

    def start_publishing(self, host, github):
        if self.pull:
            identifier = self.name + "-" + self.pull['head']['sha']
        else:
            identifier = self.name + "-" + time.strftime("%Y-%m-%d")

        requests = [ ]

        body_text = ("Image creation for %s in process on %s.\nLog: :link"
                     % (self.image, testinfra.HOSTNAME))

        if self.issue:
            requests += [
                # Get issue
                { "method": "GET",
                  "resource": github.qualify("issues/" + str(self.issue['number'])),
                  "result": "issue"
                },
                # Add comment
                { "method": "POST",
                  "resource": ":issue.comments_url",
                  "data": {
                      "body": body_text
                  }
                }
            ]
        else:
            requests += [
                # Create issue
                { "method": "POST",
                  "resource": github.qualify("issues"),
                  "data": {
                      "title": testinfra.ISSUE_TITLE_IMAGE_REFRESH.format(self.image),
                      "labels": [ "bot" ],
                      "body": body_text
                  },
                  "result": "issue"
                }
            ]

        status = {
            "github": {
                "token": github.token,
                "requests": requests
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
        our_title = testinfra.ISSUE_TITLE_IMAGE_REFRESH.format(self.image)
        in_process_prefix = "Image creation for %s in process" % (self.image)
        our_in_process_prefix = "Image creation for %s in process on %s." % (self.image, testinfra.HOSTNAME)

        # If we have started without an existing issue, find the
        # youngest issue with the expected title.

        issue = self.issue
        if not issue:
            issues = github.get("issues?labels=bot&filter=all&state=all")
            for i in issues:
                if i['title'] == our_title:
                    issue = i
                    break

        # Follow the conversation to see who has won.  The first 'in
        # process' comment after a request wins.

        comments = github.get(issue['comments_url'])
        in_process = False
        we_won = True
        for body in [ issue['body'] ] + [ c['body'] for c in comments ]:
            if body == "bot: " + our_title:
                in_process = False
            if body.startswith(in_process_prefix):
                we_won = not in_process and body.startswith(our_in_process_prefix)
                in_process = True

        return we_won

    def stop_publishing(self, github, ret, user, branch):
        if ret is None:
            message = "Image creation stopped to avoid conflict."
        else:
            if ret == 0:
                if self.pull and branch:
                    message = "Image creation done: https://github.com/{}/cockpit/commits/{}".format(user, branch)
                else:
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

        if not self.pull and branch:
            requests += [
                # Turn issue into pull request
                { "method": "POST",
                  "resource": github.qualify("pulls"),
                  "data": {
                      "issue": ":issue.number",
                      "head": user + "::" + branch,
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

        if self.issue and 'pull_request' in self.issue:
            self.pull = github.get(self.issue['pull_request']['url'])

        if opts.publish:
            self.start_publishing(opts.publish, github)

        user = github.get("/user")['login']

        msg = "Creating image {0} on {1}...\n".format(self.image, testinfra.HOSTNAME)
        sys.stderr.write(msg)

        if self.pull:
            subprocess.check_call([ "git", "fetch", "origin", "pull/{}/head".format(self.pull['number']) ])
            subprocess.check_call([ "git", "checkout", self.pull['head']['sha'] ])

        def check():
            if not self.check_publishing(github):
                self.overtaken = True
                return False
            return True

        cmd = [ "./vm-create", "--verbose", "--upload" ]
        if 'store' in self.config:
            cmd += [ "--store", self.config['store'] ]
        cmd += [ self.image ]

        os.environ['VIRT_BUILDER_NO_CACHE'] = "yes"
        proc = subprocess.Popen(cmd)
        self.overtaken = False
        ret = testinfra.wait_testing(proc, check)

        if self.overtaken:
            if self.sink:
                self.stop_publishing(github, None, None, None)
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

        if self.pull:
            branch = "refresh-" + self.image + "-" + self.pull['head']['sha']
        else:
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
            self.stop_publishing(github, ret, user, branch if have_branch else None)
