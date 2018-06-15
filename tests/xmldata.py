# -*- coding: utf-8 -*-
"""Minimal libvirt XML definition of entities to be used in the test suite.
"""

minimal_domain_xml = '''
<domain type="test">
  <name>foo</name>
  <memory>1024</memory>
  <os>
    <type>hvm</type>
  </os>
</domain>
'''

minimal_network_xml = '''
<network>
  <name>bar</name>
  <uuid>004b96e12d78c30f5aa5f03c87d21e69</uuid>
  <bridge name='brdefault'/>
  <forward dev='eth0'/>
  <ip address='192.168.122.1' netmask='255.255.255.0'>
    <dhcp>
      <range start='192.168.122.128' end='192.168.122.253'/>
    </dhcp>
  </ip>
</network>
'''

minimal_node_device_xml = '''
<device>
  <name>scsi_host22</name>
  <parent>scsi_host2</parent>
  <capability type='scsi_host'>
    <host>22</host>
    <unique_id>22</unique_id>
    <capability type='fc_host'>
      <wwnn>2000000098765432</wwnn>
      <wwpn>1000000098765432</wwpn>
      <fabric_wwn>2000000098769876</fabric_wwn>
    </capability>
  </capability>
</device>
'''

minimal_storage_pool_xml = '''
<pool type='dir'>
  <name>foo</name>
  <uuid>35bb2ad9-388a-cdfe-461a-b8907f6e53fe</uuid>
  <target>
    <path>/foo</path>
  </target>
</pool>
'''

minimal_storage_vol_xml = '''
<volume>
  <name>sparse.img</name>
  <capacity unit="G">2</capacity>
  <target>
    <path>/var/lib/virt/images/sparse.img</path>
  </target>
</volume>
'''
