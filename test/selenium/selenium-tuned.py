from testlib_avocado.seleniumlib import SeleniumTest, clickable, visible, invisible
import os
import sys

machine_test_dir = os.path.dirname(os.path.realpath(__file__))
if machine_test_dir not in sys.path:
    sys.path.insert(1, machine_test_dir)


class TunedProfiles(SeleniumTest):
    """
    :avocado: enable
    """

    def setUp(self):
        super().setUp()
        self.balanced_profile = "balanced"
        self.desktop_profile = "desktop"
        self.prepare_machine_execute()
        self.machine.execute("sudo systemctl start tuned", quiet=True)
        self.machine.execute("sudo tuned-adm profile {}".format(self.balanced_profile), quiet=True)
        self.machine.execute("/usr/sbin/tuned-adm active", quiet=True)
        self.login()

    def get_profile(self):
        return self.machine.execute("/usr/sbin/tuned-adm active", quiet=True).strip().rsplit(" ", 1)[1]

    def testPerformaceProfiles(self):
        self.click(self.wait_link('Overview', cond=clickable))
        self.wait_frame("system")
        self.click(self.wait_text(self.balanced_profile, cond=clickable))
        self.wait_text("Change Performance Profile")
        self.click(self.wait_text(self.desktop_profile, element="p", cond=clickable))
        self.click(self.wait_text("Change Profile", element="button", cond=clickable))
        self.wait_text("Change Performance Profile", cond=invisible)
        self.wait_id("overview", cond=visible)
        self.wait_text(self.desktop_profile, cond=clickable)
        self.assertIn(self.desktop_profile, self.get_profile())

        self.click(self.wait_text(self.desktop_profile, cond=clickable))
        self.wait_text("Change Performance Profile")
        self.click(self.wait_text(self.balanced_profile, element="p", cond=clickable))
        self.click(self.wait_text("Change Profile", element="button", cond=clickable))
        self.wait_text("Change Performance Profile", cond=invisible)
        self.wait_id("overview", cond=visible)
        self.wait_text(self.balanced_profile, cond=clickable)
        self.assertIn(self.balanced_profile, self.get_profile())
