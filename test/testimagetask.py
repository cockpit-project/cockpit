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

    def stop_publishing(self, ret):
        if ret == 0:
            message = "Image creation done"
        else:
            message = "Image creation failed"
        self.sink.status['github']['message'] = message
        self.sink.flush()

    def run(self, opts, github):

        if opts.publish:
            self.start_publishing(opts.publish, github)

        msg = "Creating image {0} on {1}...\n".format(self.image, testinfra.HOSTNAME)
        sys.stderr.write(msg)

        cmd = [ "./vm-create", "--upload", "--verbose", self.image ]

        proc = subprocess.Popen(cmd)
        ret = testinfra.wait_testing(proc, lambda: self.check_publishing(github))

        if self.sink:
            self.stop_publishing(ret)
