from testlib_avocado.seleniumlib import SeleniumTest


class TextInBashRC(SeleniumTest):
    """
    :avocado: enable
    """

    def setUp(self):
        super().setUp()
        self.login()
        self.machine.execute("cp ~/.bashrc ~/.bashrc.old")
        self.machine.execute("echo 'echo hallo' >> ~/.bashrc")
        self.logout()

    def test(self):
        self.login()

    def tearDown(self):
        self.machine.execute("mv ~/.bashrc.old ~/.bashrc")
        super().tearDown()


class SessionLoggingShell(SeleniumTest):
    """
    :avocado: enable
    """

    def setUp(self):
        super().setUp()
        self.user = "admin1"
        self.password = "secretpass"
        self.login()
        self.logout()
        self.machine.execute("rpm -q tlog || sudo yum  install -y tlog", timeout=240)
        self.machine.execute("sudo useradd -m {}".format(self.user))
        self.machine.execute("echo '{}:{}' | sudo chpasswd".format(self.user, self.password))

    def testShell(self):
        self.login(tmpuser=self.user, tmppasswd=self.password, add_ssh_key=False, authorized=False)
        self.assertIn(self.user, self.wait_id("content-user-name").text)
        self.logout()

    def testRecordingShell(self):
        self.machine.execute("sudo usermod admin1 -s /usr/bin/tlog-rec-session")
        self.login(tmpuser=self.user, tmppasswd=self.password, add_ssh_key=False, authorized=False)
        self.assertIn(self.user, self.wait_id("content-user-name").text)
        self.logout()

    def tearDown(self):
        self.machine.execute("sudo userdel -rf {}".format(self.user))
        super().tearDown()
