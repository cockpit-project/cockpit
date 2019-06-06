import os
from avocado import skipIf
from testlib_avocado.machineslib import MachinesLib
from testlib_avocado.seleniumlib import clickable, invisible, text_in


class MachinesStoragePoolTestSuite(MachinesLib):
    """
    :avocado: enable
    :avocado: tags=machines
    """

    def testCheckStoragePool(self):
        self.wait_css('#card-pf-storage-pools')
        cmd_active = int(self.machine.execute('virsh pool-list | awk \'NR>=3{if($0!="")print}\' | wc -l')) + int(
            self.machine.execute('sudo virsh pool-list | awk \'NR>=3{if($0!="")print}\' | wc -l'))
        self.wait_css('#card-pf-storage-pools > div > p > span:nth-child(1)', cond=text_in, text_=str(cmd_active))

        active = int(self.wait_css(
            '#card-pf-storage-pools > div > p > span:nth-child(1)').text)
        inactive = int(self.wait_css(
            '#card-pf-storage-pools > div > p > span:nth-child(2)').text)
        total = int(self.wait_css(
            '#card-pf-storage-pools > h2 > a > span.card-pf-aggregate-status-count').text)
        self.assertEqual(total, active + inactive,
                         "Storage pools' total num is not the same as the sum of active and inactive")

        self.click(self.wait_text('Storage Pools', cond=clickable))
        self.wait_css('#storage-pools-listing')

        # iterate groups elements
        page_active = 0
        page_inactive = 0
        group = self.driver.find_elements_by_css_selector(
            '#storage-pools-listing table tbody')
        self.assertEqual(len(group), total)
        for el in group:
            if el.find_element_by_css_selector(
                    'tr > td > span').text == 'active':
                page_active += 1
            elif el.find_element_by_css_selector(
                    'tr > td > span').text == 'inactive':
                page_inactive += 1

        cmd_total = int(self.machine.execute('virsh pool-list --all | wc -l')) - 3 + int(self.machine.execute('sudo virsh pool-list --all | wc -l')) - 3
        self.assertEqual(cmd_total, page_active + page_inactive)
        self.assertEqual(active, page_active)
        self.assertEqual(inactive, page_inactive)
        self.click(self.wait_css('#app > div > ol > li > a'))
        self.wait_css('#storage-pools-listing', cond=invisible)
        self.wait_css('#virtual-machines-listing')

    def testCreateDirStoragePool(self):
        name = 'test_storage_pool_' + MachinesLib.random_string()
        path = '/home/test_' + MachinesLib.random_string()
        self.machine.execute('sudo mkdir -p {}'.format(path))

        pool_name = self.create_storage_by_ui(name=name, target_path=path)

        info = self.wait_css(
            'tr[data-row-id="' + pool_name + '"] > td:nth-child(4)').text.split(
            '/')
        allocation_from_page = '%.2f' % float(info[0].strip())
        capacity_from_page = '%.2f' % float(info[1].split(' ')[1])

        allocation_from_cmd = self.machine.execute('sudo virsh pool-info {} | grep Allocation'.format(name)).split(' ')
        capacity_from_cmd = self.machine.execute('sudo virsh pool-info {} | grep Capacity'.format(name)).split(' ')

        if allocation_from_cmd[-1].strip() == 'MiB':
            allocation_from_cmd = '%.2f' % (float(allocation_from_cmd[-2]) / 1024)
        elif allocation_from_cmd[-1].strip() == 'TiB':
            allocation_from_page = '%.2f' % (float(allocation_from_page) / 1024)
            allocation_from_cmd = '%.2f' % float(allocation_from_cmd[-2])
        else:
            allocation_from_cmd = '%.2f' % float(allocation_from_cmd[-2])

        if capacity_from_cmd[-1].strip() == 'MiB':
            capacity_from_cmd = '%.2f' % (float(capacity_from_cmd[-2]) / 1024)
        elif capacity_from_cmd[-1].strip() == 'TiB':
            capacity_from_page = '%.2f' % (float(capacity_from_page) / 1024)
            capacity_from_cmd = '%.2f' % float(capacity_from_cmd[-2])
        else:
            capacity_from_cmd = '%.2f' % float(capacity_from_cmd[-2])

        self.assertEqual(allocation_from_page, allocation_from_cmd)
        self.assertEqual(capacity_from_page, capacity_from_cmd)

    @skipIf(os.environ.get('NFS') is None,
            'Users should define an environment for NFS location')
    def testCreateNFSStoragePool(self):
        name = 'test_nfs_storage_pool_' + MachinesLib.random_string()
        self.storage_pool['pool'] = name

        path = '/home/test_nfs_' + MachinesLib.random_string()
        self.machine.execute('sudo mkdir -p {}'.format(path))

        pool_name = self.create_storage_by_ui(
            name=name, storage_type='netfs', target_path=path,
            host=os.environ.get('NFS'), source_path='/home/nfs', start_up=False)

        info = self.wait_css(
            'tr[data-row-id="' + pool_name + '"] > td:nth-child(4)').text.split(
            '/')
        allocation_from_page = '%.2f' % float(info[0].strip())
        capacity_from_page = '%.2f' % float(info[1].split(' ')[1])

        allocation_from_cmd = self.machine.execute('sudo virsh pool-info {} | grep Allocation'.format(name)).split(' ')
        capacity_from_cmd = self.machine.execute('sudo virsh pool-info {} | grep Capacity'.format(name)).split(' ')

        if allocation_from_cmd[-1].strip() == 'MiB':
            allocation_from_cmd = '%.2f' % (float(allocation_from_cmd[-2]) / 1024)
        else:
            allocation_from_cmd = '%.2f' % float(allocation_from_cmd[-2])
        if capacity_from_cmd[-1].strip() == 'MiB':
            capacity_from_cmd = '%.2f' % (float(capacity_from_cmd[-2]) / 1024)
        else:
            capacity_from_cmd = '%.2f' % float(capacity_from_cmd[-2])

        self.assertEqual(allocation_from_page, allocation_from_cmd)
        self.assertEqual(capacity_from_page, capacity_from_cmd)
