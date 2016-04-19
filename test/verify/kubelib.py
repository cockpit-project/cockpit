#!/usr/bin/python
# -*- coding: utf-8 -*-

# This file is part of Cockpit.
#
# Copyright (C) 2016 Red Hat, Inc.
#
# Cockpit is free software; you can redistribute it and/or modify it
# under the terms of the GNU Lesser General Public License as published by
# the Free Software Foundation; either version 2.1 of the License, or
# (at your option) any later version.
#
# Cockpit is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
# Lesser General Public License for more details.
#
# You should have received a copy of the GNU Lesser General Public License
# along with Cockpit; If not, see <http://www.gnu.org/licenses/>.

import os

from common.testlib import *

base_dir = os.path.dirname(os.path.realpath(__file__))

__all__ = (
    'KubernetesCase',
    'KubernetesCommonTests',
    'OpenshiftCommonTests',
)

class KubernetesCase(MachineCase):

    def start_kubernetes(self):
        self.machine.execute("systemctl start docker || journalctl -u docker")
        self.machine.execute("systemctl start etcd kube-apiserver kube-controller-manager kube-scheduler kube-proxy kubelet")

    # HACK: https://github.com/GoogleCloudPlatform/kubernetes/issues/8311
    # Work around for the fact that kube-apiserver doesn't notify about startup
    # We wait until available or timeout.
    def wait_api_server(self, port=8080, timeout=60, scheme='http'):
        waiter = """
        port=%d
        timeout=%d
        scheme=%s
        for a in $(seq 0 $timeout); do
            if curl -o /dev/null -k -s $scheme://localhost:$port; then
                break
            fi
            sleep 0.5
        done
        """ % (port, timeout * 2, scheme)
        self.machine.execute(script=waiter)

class VolumeTests(object):
    def testVolumes(self):
        b = self.browser
        m = self.machine

        # If openshift use, nfs pv for tests
        # Otherwise use hostPath
        pv_id = "pv2"
        pv1_size = "1Gi"
        pv2_size = "5Gi"
        if hasattr(self, "openshift"):
            pv_id = "pv1"
            pv1_size = "5Gi"
            pv2_size = "1Gi"
            m = self.openshift

        self.login_and_go("/kubernetes")
        b.wait_present("#kubernetes-volumes")
        b.click("#kubernetes-volumes")
        b.wait_present(".pv-listing")

        b.wait_present("#register-volume")
        b.click("#register-volume")
        b.wait_present("modal-dialog")
        b.click("modal-dialog #volume-type button ")
        b.click("#volume-type #volume-type-nfs")
        b.wait_in_text("modal-dialog #volume-type button", "NFS")

        b.set_val("modal-dialog #modify-name", "A Bad Name")
        b.set_val("modal-dialog #modify-capacity", "invalid")
        b.set_val("modal-dialog #nfs-modify-server", "a bad server")
        b.set_val("modal-dialog #modify-path", "tmp")
        b.set_val("modal-dialog #modify-read-only", "tmp")
        b.click("modal-dialog .modal-footer button.btn-primary")

        b.wait_present("modal-dialog tr:nth-child(2) div.dialog-error")
        b.wait_present("modal-dialog tr:nth-child(3) div.dialog-error")
        b.wait_present("modal-dialog tr:nth-child(5) div.dialog-error")
        b.wait_present("modal-dialog tr:nth-child(6) div.dialog-error")
        b.wait_present("modal-dialog tr:nth-child(7) div.dialog-error")

        b.set_val("modal-dialog #modify-name", "pv1")
        b.set_val("modal-dialog #modify-capacity", pv1_size)
        b.set_val("modal-dialog #nfs-modify-server", "10.111.112.101")
        b.set_val("modal-dialog #modify-path", "/nfsexport")
        b.set_val("modal-dialog #modify-policy-Retain", "Retain");
        b.click("modal-dialog #modify-policy-Retain")
        b.click("modal-dialog #modify-access-ReadWriteMany")

        b.click("modal-dialog .modal-footer button.btn-primary")
        b.wait_not_present("modal-dialog")
        b.wait_present(".pv-listing tbody[data-id='pv1']")

        b.click("#register-volume")
        b.wait_present("modal-dialog")
        b.click("modal-dialog #volume-type button ")
        b.click("#volume-type #volume-type-hostPath")
        b.wait_in_text("modal-dialog #volume-type button", "Host Path")

        b.set_val("modal-dialog #modify-name", "pv2")
        b.set_val("modal-dialog #modify-capacity", pv2_size)
        b.wait_not_present("modal-dialog #nfs-modify-server")
        b.set_val("modal-dialog #modify-path", "/tmp")
        b.click("modal-dialog #modify-policy-Retain")
        b.click("modal-dialog #modify-access-ReadWriteMany")

        b.click("modal-dialog .modal-footer button.btn-primary")
        b.wait_not_present("modal-dialog")
        b.wait_present(".pv-listing tbody[data-id='pv2']")

        m.upload(["verify/files/glusterfs-volume.json"], "/tmp")
        m.execute("kubectl create -f /tmp/glusterfs-volume.json")
        b.wait_present(".pv-listing tbody[data-id='gluster-volume']")

        b.click(".pv-listing tbody[data-id='pv2'] th")
        b.wait_present(".content-filter")
        b.wait_in_text(".listing-inline", "/tmp")
        b.wait_in_text(".listing-inline", "This volume has not been claimed")
        b.wait_present(".content-filter button.pficon-edit")
        b.click(".content-filter button.pficon-edit")
        b.wait_present("modal-dialog")

        b.wait_not_present("modal-dialog input#modify-name")
        b.wait_in_text("modal-dialog span#modify-name", "pv2")
        b.wait_not_present("modal-dialog input#modify-capacity")
        b.wait_in_text("modal-dialog span#modify-capacity", pv2_size)

        if m.image == "openshift":
            b.set_val("modal-dialog #modify-path", "/not-tmp")
            b.click("modal-dialog .modal-footer button.btn-primary")
            b.wait_not_present("modal-dialog")
            b.wait_in_text(".listing-inline", "/not-tmp")
        else:
            b.click("modal-dialog button.btn-default")
            b.wait_not_present("modal-dialog")

        b.click("a.hidden-xs")
        b.wait_present(".pv-listing tbody[data-id='gluster-volume']")
        b.click(".pv-listing tbody[data-id='gluster-volume'] th")
        b.wait_present(".content-filter")
        b.wait_present(".content-filter button.btn-delete")
        b.wait_not_present(".content-filter button.pficon-edit")
        b.click(".content-filter button.btn-delete")
        b.wait_present("modal-dialog")
        b.wait_present("modal-dialog .modal-footer button.btn-danger")
        b.click("modal-dialog .modal-footer button.btn-danger")
        b.wait_present(".pv-listing")
        b.wait_not_present(".pv-listing tbody[data-id='gluster-volume']")

        base_sel = ".pv-listing tbody[data-id='{}']".format(pv_id)
        b.click(".filter-menu button.dropdown-toggle")
        b.click(".filter-menu li:first-child a")
        b.wait_present(base_sel)
        b.click("{} th".format(base_sel))
        b.wait_present("{} .listing-status".format(base_sel))
        b.wait_in_text("{} .listing-status".format(base_sel), "Available")

        m.upload(["verify/files/mock-volume-tiny-app.json"], "/tmp")
        m.execute("kubectl create -f /tmp/mock-volume-tiny-app.json")

        b.wait_in_text("{} .listing-status".format(base_sel), "Bound")
        b.click("{} .listing-panel ul.nav-tabs li:nth-child(2) a".format(base_sel))
        b.wait_in_text("{} .listing-panel".format(base_sel), "mock-volume-claim")
        b.wait_in_text("{} .listing-panel ".format(base_sel), "default / mock-volume")

        pods = m.execute('kubectl get pods --output=template -t="{{ range .items }}{{.metadata.name}}|{{ end }}"')
        pod = [ x for x in pods.split("|") if x.startswith("mock-volume")][0]
        pod_id = "pods/default/{}".format(pod)

        b.click("a[href='#/list']")
        b.wait_present("#content .details-listing")
        b.wait_present("#content .details-listing tbody[data-id='{}']".format(pod_id))
        b.click("#content .details-listing tbody[data-id='{}'] th".format(pod_id))
        b.wait_present(".listing-panel ul.nav-tabs")
        b.click(".listing-panel ul.nav-tabs li:last-child a".format(pod_id))
        b.wait_present(".listing-body")
        b.wait_js_func("ph_count_check", ".listing-body div.well", 2)

        volumes = m.execute('kubectl get pods/%s --output=template -t="{{ range .spec.volumes }}{{.name}}|{{ end }}"' % pod)
        secret = [ x for x in volumes.split("|") if x.startswith("default-token")][0]

        b.wait_in_text(".listing-body div[data-id='{}']".format(secret), "Secret")
        b.wait_in_text(".listing-body div[data-id='{}']".format(secret), "mock-volume-container")
        b.wait_in_text(".listing-body div[data-id='{}']".format(secret), "/var/run/secrets/kubernetes.io/serviceaccount")
        b.wait_present(".listing-body div[data-id='host-tmp']")
        b.wait_in_text(".listing-body div[data-id='host-tmp']", "Persistent Volume Claim")
        b.wait_in_text(".listing-body div[data-id='host-tmp']", "mock-volume-claim")
        b.wait_in_text(".listing-body div[data-id='host-tmp']", "mock-volume-container")
        b.wait_in_text(".listing-body div[data-id='host-tmp']", "/mount-path-tmp")
        b.wait_present(".listing-body div[data-id='host-tmp'] a[href='#/volumes/{}']".format(pv_id))

class KubernetesCommonTests(VolumeTests):

    def add_node(self, b, name, address):
        b.wait_present("modal-dialog")
        b.set_val("#node-name", name)
        b.set_val("#node-address", address)
        b.click("modal-dialog .btn-primary")
        b.wait_not_present("modal-dialog .dialog-wait")
        b.wait_not_present("modal-dialog")

    def check_logs(self, b):
        # Check that container log output shows up
        b.click("#content .containers-listing tbody:first-of-type tr th")
        b.wait_present("tbody.open .listing-panel .listing-head")
        b.wait_in_text("tbody.open .listing-panel .listing-head .listing-status", "running")
        b.click("tbody.open .listing-panel .listing-head li a.logs")
        b.wait_present("tbody.open .listing-panel pre.logs")
        b.wait_visible("tbody.open .listing-panel pre.logs")
        b.wait_in_text("tbody.open .listing-panel pre.logs", "HelloMessage.")

    def check_shell(self, b):
        b.wait_present("tbody.open .listing-panel .listing-head li a.shell")
        b.click("tbody.open .listing-panel .listing-head li a.shell")
        b.wait_present("tbody.open .listing-panel div.terminal")
        b.wait_visible("tbody.open .listing-panel div.terminal")
        b.wait_in_text("tbody.open .listing-panel .terminal div:nth-child(1)", "#")
        b.focus('tbody.open .listing-panel .terminal')
        b.key_press( [ 'w', 'h', 'o', 'a', 'm', 'i', 'Return' ] )
        b.wait_in_text("tbody.open .listing-panel .terminal div:nth-child(2)", "root")

    def testDelete(self):
        b = self.browser
        m = self.machine
        b.wait_timeout(120)

        self.login_and_go("/kubernetes")
        b.wait_present("#node-list")
        b.wait_in_text("#node-list", "127.0.0.1")

        m.execute("kubectl create -f /tmp/mock-k8s-tiny-app.json")
        b.wait_in_text("#service-list", "mock")

        pods = m.execute('kubectl get pods --output=template -t="{{ range .items }}{{.metadata.name}}|{{ end }}"')
        podl = pods.split("|")
        b.click("a[href='#/list']")
        b.wait_present("#content .details-listing")
        b.wait_present("#content .details-listing tbody[data-id='services/default/mock']")
        self.assertEqual(b.text(".details-listing tbody[data-id='services/default/mock'] th"), "mock")
        b.wait_present("#content .details-listing tbody[data-id='replicationcontrollers/default/mock']")
        self.assertEqual(b.text(".details-listing tbody[data-id='replicationcontrollers/default/mock'] th"), "mock")
        b.wait_present(".details-listing tbody[data-id='pods/default/"+podl[0]+"'] th")
        self.assertEqual(b.text(".details-listing tbody[data-id='pods/default/"+podl[0]+"'] th"), podl[0])

        b.click(".details-listing tbody[data-id='services/default/mock'] th")
        b.wait_visible(".details-listing tbody[data-id='services/default/mock'] .delete-entity")
        b.click(".details-listing tbody[data-id='services/default/mock'] .delete-entity")
        b.wait_present("modal-dialog")
        b.click("modal-dialog .btn-danger")
        b.wait_not_present("modal-dialog")
        b.wait_not_present(".details-listing tbody[data-id='services/default/mock']")

        b.click(".details-listing tbody[data-id='replicationcontrollers/default/mock'] th")
        b.wait_visible(".details-listing tbody[data-id='replicationcontrollers/default/mock'] .delete-entity")
        b.click(".details-listing tbody[data-id='replicationcontrollers/default/mock'] .delete-entity")
        b.wait_present("modal-dialog")
        b.click("modal-dialog .btn-danger")
        b.wait_not_present("modal-dialog")
        b.wait_not_present(".details-listing tbody[data-id='replicationcontrollers/default/mock']")

        b.click(".details-listing tbody[data-id='pods/default/"+podl[0]+"'] th")
        b.wait_visible(".details-listing tbody[data-id='pods/default/"+podl[0]+"'] .delete-pod")
        b.click(".details-listing tbody[data-id='pods/default/"+podl[0]+"'] .delete-pod")
        b.wait_present("modal-dialog")
        b.wait_in_text("modal-dialog .modal-body", "Deleting a Pod will")
        b.click("modal-dialog .btn-danger")
        b.wait_not_present("modal-dialog")
        b.wait_not_present(".details-listing tbody[data-id='pods/default/"+podl[0]+"']")

    def testDashboard(self):
        b = self.browser
        m = self.machine

        self.login_and_go("/kubernetes")
        b.wait_present("#node-list")
        b.wait_in_text("#node-list", "127.0.0.1")

        m.execute("kubectl create -f /tmp/mock-k8s-tiny-app.json")
        b.wait_in_text("#service-list", "mock")

        # Successfully deploy via dialog
        b.click("#deploy-app")
        b.wait_present("modal-dialog")
        b.upload_file("#deploy-app-manifest-file", os.path.join(base_dir, "files/mock-k8s-tiny-app.json"))
        b.wait_val("#deploy-app-namespace", "")
        b.set_val("#deploy-app-namespace", "mynamespace1")
        b.wait_in_text("#deploy-app-namespace-group ul", "default")
        b.click("modal-dialog .btn-primary")
        b.wait_not_present("modal-dialog .dialog-wait")
        b.wait_not_present("modal-dialog")
        b.wait_in_text("#service-list", "mynamespace1")
        b.wait_in_text("#service-list", "default")

        # Fail deploy via dialog
        b.click("#deploy-app")
        b.wait_present("modal-dialog")
        b.upload_file("#deploy-app-manifest-file", os.path.join(base_dir, "files/mock-k8s-tiny-app.json"))
        b.set_val("#deploy-app-namespace", "!!!!")
        b.click("modal-dialog .btn-primary")
        b.wait_not_present("modal-dialog .dialog-wait")
        b.wait_present("modal-dialog .dialog-error")
        b.click("modal-dialog .btn-cancel")
        b.wait_not_present("modal-dialog")

        # Successfully add node via dialog
        b.click("#add-node")
        self.add_node(b, "mynode", "myaddress")
        b.wait_in_text("#node-list", "mynode")

        # Fail add node via dialog
        b.click("#add-node")
        b.wait_present("modal-dialog")
        b.set_val("#node-name", "!!!!")
        b.set_val("#node-address", "!!!!")
        b.click("modal-dialog .btn-primary")
        b.wait_not_present("modal-dialog .dialog-wait")
        b.wait_present("modal-dialog .dialog-error")
        b.click("modal-dialog .btn-cancel")
        b.wait_not_present("modal-dialog")

        # Make sure pod has started
        with b.wait_timeout(120):
            b.wait_text("#service-list tr[data-name='mock']:first-of-type td.containers", "1")

        # Adjust the service
        b.click("#services-enable-change")
        b.click("#service-list tr[data-name='mock']:first-of-type button")
        b.wait_present("modal-dialog")
        b.set_val("modal-dialog input.adjust-replica", 2)
        b.click("modal-dialog .btn-primary")
        b.wait_not_present("modal-dialog .dialog-wait")
        b.wait_not_present("modal-dialog")
        b.click("#services-enable-change")
        b.wait_in_text("#service-list tr[data-name='mock']:first-of-type td.containers", "2")

        # Check that clicking on service goes to containers
        b.click("#service-list tr[data-name='mock']:first-of-type td.containers")
        b.wait_present("#content .containers-listing tbody tr th")
        self.assertEqual(b.text("#content .containers-listing tbody:first-of-type tr th"), "mock-container")

        self.check_logs(b)
        self.check_shell(b)

        # Check that service shows up on listing view
        b.click("a[href='#/list']")
        b.wait_present("#content .details-listing")
        b.wait_present(".details-listing tbody[data-id='services/default/mock']")
        self.assertEqual(b.text(".details-listing tbody[data-id='services/default/mock'] th"), "mock")
        b.wait_present(".details-listing tbody[data-id='replicationcontrollers/default/mock']")
        self.assertEqual(b.text(".details-listing tbody[data-id='replicationcontrollers/default/mock'] th"), "mock")
        b.wait_not_present("#routes")
        b.wait_not_present("#deployment-configs")

        # Click on the service to expand into a panel
        b.click(".details-listing tbody[data-id='services/default/mock'] th")
        b.wait_present(".details-listing tbody[data-id='services/default/mock'] tr.listing-panel")
        self.assertFalse(b.is_visible(".details-listing tbody[data-id='services/default/mock'] th"))
        self.assertEqual(b.text("tbody[data-id='services/default/mock'] tr.listing-panel h3"), "mock")

        # Now the header and other services should still be present, check filter menu state
        self.assertTrue(b.is_present(".details-listing thead th"))
        self.assertTrue(b.is_present(".details-listing tbody tr.listing-item"))
        b.wait_not_present(".filter-menu li.active")

        # Click the first link to show make only selected
        b.wait_visible(".filter-menu .btn.dropdown-toggle")
        b.click(".filter-menu .btn.dropdown-toggle")
        b.click(".filter-menu li:first-child a")
        b.wait_present(".filter-menu li.checked")
        b.wait_in_text(".filter-menu li.checked", "expanded items")
        self.assertFalse(b.is_present(".details-listing thead th"))
        self.assertFalse(b.is_present(".details-listing tbody tr.listing-item"))
        self.assertTrue(b.is_present(".details-listing tr.listing-panel"))

        # Clear the selection via the menu
        b.click(".filter-menu .btn.dropdown-toggle")
        b.click(".filter-menu li:last-child a")
        b.wait_not_present(".filter-menu li.checked")
        self.assertTrue(b.is_present(".details-listing thead th"))
        self.assertTrue(b.is_present(".details-listing tbody tr.listing-item"))
        self.assertFalse(b.is_present(".details-listing tr.listing-panel"))

        # Back to dashboard
        b.click("a[href='#/']")
        b.wait_in_text("#service-list", "mock")

        # Switch to filtered view
        b.click(".namespace-filter .btn.dropdown-toggle")
        b.click(".namespace-filter li:last-child a")
        b.wait_in_text("#service-list", "mynamespace1")
        b.wait_not_in_text("#service-list", "default")

        # Deploy app in a namespace that isn't selected
        b.click("#deploy-app")
        b.wait_present("modal-dialog")
        b.upload_file("#deploy-app-manifest-file", os.path.join(base_dir, "files/mock-k8s-tiny-app.json"))
        b.wait_val("#deploy-app-namespace", "mynamespace1")
        b.set_val("#deploy-app-namespace", "mynamespace2")
        b.click("modal-dialog .btn-primary")
        b.wait_not_present("modal-dialog .dialog-wait")
        b.wait_not_present("modal-dialog")

        # mynamespace2 is now selected
        b.wait_in_text("#service-list", "mynamespace2")
        b.wait_not_in_text("#service-list", "default")
        b.wait_not_in_text("#service-list", "mynamespace1")
        b.wait_js_cond('window.location.hash == "#/?namespace=mynamespace2"')
        b.wait_in_text(".namespace-filter button", "mynamespace2")

    def testNodes(self):
        m = self.machine
        b = self.browser

        self.login_and_go("/kubernetes")
        b.wait_present("#node-list")
        b.wait_in_text("#node-list", "127.0.0.1")

        b.click("#node-list tbody tr:first-child")

        b.wait_present(".listing-inline")
        b.wait_in_text(".listing-inline", "Node")
        b.wait_in_text(".listing-inline", "Capacity")
        b.wait_present(".content-filter h3")
        b.wait_text(".content-filter h3", "127.0.0.1")
        b.click("a.hidden-xs")

        b.wait_present(".nodes-listing")
        b.wait_present("#add-node")
        b.click("#add-node")
        self.add_node(b, "mynode", "myaddress")
        b.wait_present(".nodes-listing tbody[data-id='mynode']")
        b.click(".nodes-listing tbody[data-id='mynode'] tr")
        b.wait_present(".content-filter h3")
        b.wait_text(".content-filter h3", "mynode")
        b.click("a.hidden-xs")

        b.wait_present(".nodes-listing")
        b.click(".filter-menu button.dropdown-toggle")
        b.click(".filter-menu li:first-child a")

        b.wait_present(".nodes-listing tbody[data-id='127.0.0.1']")
        b.click(".nodes-listing tbody[data-id='127.0.0.1'] th")
        b.wait_present(".nodes-listing tbody[data-id='127.0.0.1'] tr.listing-panel")
        self.assertEqual(b.text("tbody[data-id='127.0.0.1'] tr.listing-panel h3"), "127.0.0.1")
        self.assertFalse(b.is_visible(".nodes-listing tbody[data-id='127.0.0.1'] th"))
        b.wait_in_text("tbody[data-id='127.0.0.1'] tr.listing-panel .status", "Ready")

        b.wait_present(".nodes-listing tbody[data-id='mynode']")
        b.click(".nodes-listing tbody[data-id='mynode'] th")
        b.wait_present(".nodes-listing tbody[data-id='mynode'] tr.listing-panel")
        self.assertEqual(b.text("tbody[data-id='mynode'] tr.listing-panel h3"), "mynode")
        self.assertFalse(b.is_visible(".nodes-listing tbody[data-id='mynode'] th"))
        self.assertEqual(b.text("tbody[data-id='mynode'] tr.listing-panel .status").strip(), "Unknown")

    def testTopology(self):
        m = self.machine
        b = self.browser

        m.execute("kubectl create -f /tmp/mock-k8s-tiny-app.json")

        # The service has loaded and containers instantiated
        self.login_and_go("/kubernetes")
        b.wait_present("#service-list tr[data-name='mock'] td.containers")
        with b.wait_timeout(120):
            b.wait_text("#service-list tr[data-name='mock'] td.containers", "1")

        # Switch to topology view
        b.click("a[href='#/topology']")

        # Assert that at least one link between Service and Pod has loaded
        b.wait_present("svg line.ServicePod")

class OpenshiftCommonTests(VolumeTests):

    def testBasic(self):
        m = self.machine
        b = self.browser

        # populate routes
        self.openshift.execute("oc expose service docker-registry --hostname=test.example.com")

        self.login_and_go("/kubernetes")
        b.wait_present("#service-list")
        b.wait_in_text("#service-list", "registry")

        # Switch to detail view
        b.click("a[href='#/list']")
        b.wait_present("#content .details-listing")
        b.wait_present("#routes")
        b.wait_present("#deployment-configs")

        b.wait_present(".details-listing tbody[data-id='deploymentconfigs/default/docker-registry'] th")
        self.assertEqual(b.text(".details-listing tbody[data-id='deploymentconfigs/default/docker-registry'] th"), "docker-registry")

        b.wait_present(".details-listing tbody[data-id='routes/default/docker-registry'] th")
        self.assertEqual(b.text(".details-listing tbody[data-id='routes/default/docker-registry'] th"), "docker-registry")

        # Switch to images view
        b.click("a[href='#/images']")
        b.wait_present("tbody[data-id='marmalade/busybee:0.x']")

        # Switch to topology view
        b.click("a[href='#/topology']")
        b.wait_present("svg line.DeploymentConfigReplicationController")
        b.wait_present("svg line.RouteService")

    def testDelete(self):
        m = self.machine
        b = self.browser
        b.wait_timeout(120)

        self.login_and_go("/kubernetes")
        b.wait_present("#service-list")

        self.openshift.execute("oc create -f /tmp/mock-app-openshift.json")
        b.wait_in_text("#service-list", "mock")

        b.click("a[href='#/list']")
        b.wait_present("#content .details-listing")
        b.wait_present("#routes")
        b.wait_present("#deployment-configs")

        b.wait_present(".details-listing tbody[data-id='deploymentconfigs/default/frontend'] th")
        b.wait_present(".details-listing tbody[data-id='routes/default/mock'] th")
        self.assertEqual(b.is_present(".details-listing tbody[data-id='routes/default/mock'] th"), True)
        self.assertEqual(b.is_present(".details-listing tbody[data-id='deploymentconfigs/default/frontend'] th"), True)

        b.click(".details-listing tbody[data-id='routes/default/mock'] th")
        b.wait_visible(".details-listing tbody[data-id='routes/default/mock'] .route-delete")
        b.click(".details-listing tbody[data-id='routes/default/mock'] .route-delete")
        b.wait_present("modal-dialog")
        b.wait_in_text("modal-dialog .modal-header", "Delete Route")
        b.wait_in_text("modal-dialog .modal-body", "Route 'mock'")
        b.click(".modal-footer button.btn-danger")
        b.wait_not_present("modal-dialog")
        b.wait_not_present(".details-listing tbody[data-id='routes/default/mock']")

        b.click(".details-listing tbody[data-id='deploymentconfigs/default/frontend'] th")
        b.wait_visible(".details-listing tbody[data-id='deploymentconfigs/default/frontend'] .deployment-delete")
        b.click(".details-listing tbody[data-id='deploymentconfigs/default/frontend'] .deployment-delete")
        b.wait_present("modal-dialog")
        b.click(".modal-footer button.btn-danger")
        b.wait_not_present("modal-dialog")
        b.wait_not_present(".details-listing tbody[data-id='deploymentconfigs/default/frontend']")
