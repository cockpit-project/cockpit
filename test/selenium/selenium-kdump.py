#!/usr/bin/python3

from testlib_avocado.seleniumlib import SeleniumTest, clickable, visible
import os
import sys

machine_test_dir = os.path.dirname(os.path.realpath(__file__))
if machine_test_dir not in sys.path:
    sys.path.insert(1, machine_test_dir)


class TestKdump(SeleniumTest):
    """
    :avocado: enable
    """
    share = "/nfsfileshare"
    default_location = "/var/crash"
    exporttab = """
{}    *(rw,sync,no_root_squash)
    """.format(share)
    export_file = '/etc/exports'
    frame_name = "localhost/kdump"

    def requirements(self):
        execs = [
            # start NFS server
            "sudo mkdir -p {}".format(self.share),
            "sudo chmod a+rwx {}".format(self.share),
            "echo '{}' | sudo tee {}".format(self.exporttab, self.export_file),
            "sudo systemctl start nfs-server rpcbind",
            "sudo exportfs -r",
            # TODO: these two lines are workaround, because it is unable otherwise create initrd for nfs
            "sudo mkdir -p {}{}".format(self.share, self.default_location),
            "sudo mount localhost:{} {}".format(self.share, self.default_location),
        ]
        for exe in execs:
            self.machine.execute(exe)

    def requirements_cleanup(self):
        execs = [
            "sudo umount {}".format(self.default_location),
            "sudo systemctl stop nfs-server rpcbind",
            "echo '' | sudo tee {}".format(self.export_file),
            "sudo rm -rf {}".format(self.share),
        ]

        for exe in execs:
            self.machine.execute(exe)

    def setUp(self):
        super().setUp()
        self.login()
        self.requirements()
        if os.environ.get("BROWSER") == 'edge':
            # HACK: Edge does not see elements (kdump menu entry) which are below the visible window area
            self.execute_script('''document.querySelector("#nav-system a[href='/kdump']").scrollIntoView()''')
        self.click(self.wait_link("Kernel Dump"))
        self.wait_frame(self.frame_name)
        self.base_element = self.wait_id("app")

    def tearDown(self):
        self.requirements_cleanup()
        super().tearDown()

    def testKdumpBasePage(self):
        self.wait_text("Crash dump location", cond=visible)

    def check_type(self, old_text, new_text, selector_item, textbox_dict):
        self.wait_text("Service is running", cond=visible)
        self.click(self.wait_text(old_text, cond=clickable))
        self.select_by_text(self.wait_id("kdump-settings-location",
                                         cond=clickable),
                            selector_item)
        for textbox_key in textbox_dict:
            location = self.wait_id(textbox_key)
            self.send_keys(location, textbox_dict[textbox_key])
        self.click(self.wait_text("Apply", cond=clickable))
        # extend waiting for regeneration of initrd image, may take long time
        self.wait_id("kdump-settings-dialog", cond=visible, reversed_cond=True, overridetry=self.default_try * 3)
        self.wait_id("app")
        self.wait_text(new_text, cond=visible)
        self.wait_text("Service is running", cond=visible)

    def check_configuration(self, location):
        self.machine.execute("systemctl is-active kdump")
        self.machine.execute("echo 1 > sudo /proc/sys/kernel/sysrq")
        self.machine.execute("echo c > sudo /proc/sysrq-trigger")
        # it does nothing now, but could be useful to check if it creates new crashdump
        return self.machine.execute("ls {}".format(location))

    def testNFS(self):
        self.check_type("locally in {}".format(self.default_location),
                        "Remote over NFS",
                        "Remote over NFS",
                        {"kdump-settings-nfs-mount": "localhost:{}".format(self.share)},
                        )
        self.check_configuration(self.share + self.default_location)

        self.check_type("Remote over NFS",
                        "locally in {}".format(self.default_location),
                        "Local Filesystem",
                        {"kdump-settings-local-directory": self.default_location},
                        )
        self.check_configuration(self.default_location)
