from testlib_avocado.seleniumlib import clickable, text_in, invisible
from testlib_avocado.machineslib import MachinesLib


class MachinesNetworkPageTestSuite(MachinesLib):
    """
    :avocado: enable
    :avocado: tags=machines
    """

    def testNetworkPageInfo(self):
        net_cmd_active = int(self.machine.execute('sudo virsh net-list | wc -l')) - 3 + int(self.machine.execute('virsh net-list | wc -l')) - 3
        self.wait_css('#card-pf-networks > div > p > span:nth-child(1)',
                      cond=text_in,
                      text_=str(net_cmd_active))

        total = int(self.wait_css('#card-pf-networks > h2 > button > span.card-pf-aggregate-status-count').text)
        active = int(self.wait_css(
            '#card-pf-networks > div > p > span:nth-child(1)').text)
        inactive = int(self.wait_css(
            '#card-pf-networks > div > p > span:nth-child(2)').text)
        self.assertEqual(total, active + inactive)

        # switch to the network page
        self.click(self.wait_css('#card-pf-networks > h2 > button',
                                 cond=clickable))
        self.wait_css('#networks-listing')

        page_active = 0
        page_inactive = 0

        el_group = self.wait_css('#networks-listing > section > table').find_elements_by_tag_name('tbody')
        self.assertEqual(len(el_group), total)

        for el in el_group:
            if el.find_element_by_css_selector('tr > td:nth-child(6) > span').text == 'active':
                page_active += 1
            elif el.find_element_by_css_selector('tr > td:nth-child(6) > span').text == 'inactive':
                page_inactive += 1

        net_cmd_total = int(self.machine.execute('sudo virsh net-list --all | wc -l')) - 3 + int(self.machine.execute('virsh net-list --all | wc -l')) - 3

        self.assertEqual(net_cmd_total, page_active + page_inactive)
        self.click(self.wait_css('#app div a'))
        self.wait_css('#networks-listing', cond=invisible)
        self.wait_css('#virtual-machines-listing')
