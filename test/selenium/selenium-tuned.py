from testlib_avocado.seleniumlib import SeleniumTest, clickable, visible
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
        super(TunedProfiles, self).setUp()
        self.login()
        self.balanced_profile = "balanced"
        self.desktop_profile = "desktop"
        self.machine.execute("sudo systemctl start tuned", quiet=True)
        self.machine.execute("sudo tuned-adm profile {}".format(self.balanced_profile), quiet=True)
        self.machine.execute("/usr/sbin/tuned-adm active", quiet=True)
        # reload page to see performance profiles
        self.driver.refresh()

    def get_profile(self):
        return self.machine.execute("/usr/sbin/tuned-adm active", quiet=True).strip().rsplit(" ", 1)[1]

    def testPerformaceProfiles(self):
        self.click(self.wait_link('System', cond=clickable))
        self.wait_frame("system")
        self.click(self.wait_text(self.balanced_profile, cond=clickable))
        self.wait_text("Change Performance Profile")
        self.click(self.wait_text(self.desktop_profile, element="p", cond=clickable))
        self.click(self.wait_text("Change Profile", element="button", cond=clickable))
        self.wait_id("server", cond=visible, jscheck=True)
        self.assertIn(self.desktop_profile, self.get_profile())

        self.click(self.wait_text(self.desktop_profile, cond=clickable))
        self.wait_text("Change Performance Profile")
        self.click(self.wait_text(self.balanced_profile, element="p", cond=clickable))
        self.click(self.wait_text("Change Profile", element="button", cond=clickable))
        self.wait_id("server", cond=visible, jscheck=True)
        self.assertIn(self.balanced_profile, self.get_profile())
