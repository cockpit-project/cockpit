from testlib_avocado.seleniumlib import clickable, invisible, text_in
from testlib_avocado.machineslib import MachinesLib


class MachinesUsageTestSuite(MachinesLib):
    """
    :avocado: enable
    :avocado: tags=machines
    """

    def testUsage(self):
        name = "staticvm"
        self.create_vm(name, state='shut off')

        self.click(self.wait_css("#vm-{}-usage".format(name), cond=clickable))
        self.wait_css('#chart-donut-0 .donut-title-big-pf', cond=text_in, text_='0.00')
        self.wait_css('#chart-donut-0 .donut-title-small-pf', cond=text_in, text_='GiB')
        self.wait_css('#chart-donut-0 + .usage-donut-caption', cond=text_in, text_='256 MiB')
        self.wait_css('#chart-donut-1 .donut-title-big-pf', cond=text_in, text_='0.0')
        self.wait_css('#chart-donut-1 .donut-title-small-pf', cond=text_in, text_='%')
        self.wait_css('#chart-donut-1 + .usage-donut-caption', cond=text_in, text_='1 vCPU')
        self.click(self.wait_css('#vm-{}-run'.format(name), cond=clickable))
        self.wait_css('#vm-{}-state'.format(name), cond=text_in, text_='running')
        self.wait_text(
            '0.00', element="div[@id='chart-donut-0']//*[contains(@class, 'donut-title-big-pf')]",
            cond=invisible)
