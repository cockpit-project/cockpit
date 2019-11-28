#!/usr/bin/python3

# we need to be able to find and import seleniumlib, so add this directory
from testlib_avocado.seleniumlib import SeleniumTest, clickable, invisible
from avocado import skipUnless
import os
import sys
machine_test_dir = os.path.dirname(os.path.abspath(__file__))
if machine_test_dir not in sys.path:
    sys.path.insert(1, machine_test_dir)


class DockerTestSuite(SeleniumTest):
    """
    :avocado: enable
    """
    test_image = "busybox"

    def setUp(self):
        super().setUp()
        self.prepare_machine_execute()
        self.machine.execute("sudo systemctl start docker")
        self.login()
        self.click(self.wait_link('Docker Containers', cond=clickable))
        self.wait_frame("docker")
        self.wait_id('containers')
        self.wait_id('containers-images')

    def check_image_present(self, image_name):
        self.wait_xpath("//tr//th[contains(text(), '%s')]" % image_name)

    def testExistingImages(self):
        self.check_image_present(self.test_image)

    def get_docker_data_list(self, command):
        output = []
        for line in self.machine.execute("sudo docker %s" % command).splitlines()[1:]:
            output.append([s.strip() for s in line.split('  ') if s])
        return output

    def get_all_images_list(self):
        return self.get_docker_data_list(command="images --no-trunc")

    def get_all_containers(self):
        return self.get_docker_data_list(command="container ps")

    def remove_containers(self, image_name_filter):
        matched = [x[0] for x in self.get_all_containers() if image_name_filter in x[1]]
        for container_id in matched:
            self.machine.execute("sudo docker stop %s" % container_id)
            self.machine.execute("sudo docker rm %s" % container_id)

    def get_image_ids(self, image_name):
        return [x[2] for x in self.get_all_images_list() if image_name in x[0]]

    def testRunImage(self):
        image_id = self.get_image_ids(self.test_image)[0]
        self.click(self.wait_xpath("//button[@data-image='%s']" % image_id, cond=clickable))
        self.wait_id("containers_run_image_dialog")
        self.click(self.wait_id("containers-run-image-run", cond=clickable))
        self.wait_id("containers_run_image_dialog", reversed_cond=True)
        self.wait_xpath("//div[@id='containers-containers']//td[contains(text(),'%s')]" % self.test_image)
        self.remove_containers(self.test_image)

    @skipUnless(os.getenv("NETWORK"), "Does not work without internet access, it searches in repositories")
    def testSearchImage(self):
        self.click(self.wait_css(".link-button", cond=clickable))
        self.wait_id('containers-search-image-dialog')
        self.send_keys(self.wait_id('containers-search-image-search'), "fedora")
        self.wait_id('containers-search-image-results')
        self.wait_text("Official Docker", element="td")
        self.click(self.wait_xpath(
            "//div[@id='containers-search-image-dialog']//button[contains(text(), '%s')]" % "Cancel", cond=clickable))
        self.wait_id('containers-search-image-dialog', cond=invisible)

    @skipUnless(os.getenv("NETWORK"), "Does not work without internet access, it searches in repositories")
    def testSearch_DownloadImage(self):
        self.click(self.wait_css(".link-button", cond=clickable))
        self.wait_id('containers-search-image-dialog')
        self.send_keys(self.wait_id('containers-search-image-search'), "cockpit")
        self.wait_id('containers-search-image-results')
        self.click(self.wait_text("Cockpit Web Ser", element="td", cond=clickable))
        self.click(self.wait_id('containers-search-download', cond=clickable))
        self.wait_id('containers-search-image-dialog', cond=invisible)
        self.wait_text('cockpit/ws')

    def testStartDockerService(self):
        self.mainframe()
        self.logout()
        self.machine.execute("sudo systemctl stop docker")
        self.login()
        self.click(self.wait_link('Docker Containers', cond=clickable))
        self.wait_frame("docker")
        self.click(self.wait_xpath("//*[@data-action='docker-start']", cond=clickable))
        self.wait_id('containers')
        self.wait_id('containers-images')
