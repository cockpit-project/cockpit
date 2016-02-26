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

    # HACK - https://bugzilla.redhat.com/show_bug.cgi?id=1243827
    #
    # HACK - https://github.com/GoogleCloudPlatform/kubernetes/issues/11222
    # The default install of kubernetes does not let you start pods due to
    # ServiceAccount admission control. So remove that.
    def fix_apiserver_config(self):
        self.machine.execute("sed -i /etc/kubernetes/apiserver -e 's/,ServiceAccount//'")

    def start_kubernetes(self):
        self.machine.execute("systemctl start etcd kube-apiserver kube-controller-manager kube-scheduler docker kube-proxy kubelet")

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

class KubernetesCommonTests(object):

    def check_logs(self, b):
        # Check that container log output shows up
        b.click("#content .containers-listing tbody:first-of-type tr th")
        b.wait_present(".listing-panel .listing-status:contains('running')")
        b.click("#content .listing-panel li a:contains('Logs')")
        b.wait_present(".listing-panel pre.logs")
        b.wait_visible(".listing-panel pre.logs")
        b.wait_in_text(".listing-panel pre.logs", "HelloMessage.")

    def check_shell(self, b):
        def line_sel(i):
            return '#terminal .terminal div:nth-child(%d)' % i

        b.wait_present("#content .listing-panel li a:contains('Shell')")
        b.click("#content .listing-panel li a:contains('Shell')")
        b.wait_present(".listing-panel div.terminal")
        b.wait_visible(".listing-panel div.terminal")
        b.wait_in_text(".listing-panel .terminal div:nth-child(1)", "#")
        b.focus('.listing-panel .terminal')
        b.key_press( [ 'w', 'h', 'o', 'a', 'm', 'i', 'Return' ] )
        b.wait_in_text(".listing-panel .terminal div:nth-child(2)", "root")

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
        self.assertEqual(b.text(".details-listing tbody[data-id='services/default/mock'] th"), "mock")
        self.assertEqual(b.text(".details-listing tbody[data-id='replicationcontrollers/default/mock'] th"), "mock")
        b.wait_present(".details-listing tbody[data-id='pods/default/"+podl[0]+"'] th")
        self.assertEqual(b.text(".details-listing tbody[data-id='pods/default/"+podl[0]+"'] th"), podl[0])

        b.click(".details-listing tbody[data-id='services/default/mock'] th")
        b.wait_visible(".details-listing tbody[data-id='services/default/mock'] .delete-entity")
        b.click(".details-listing tbody[data-id='services/default/mock'] .delete-entity")
        b.wait_popup("delete-entity-dialog")
        b.click("#delete-entity-button")
        b.wait_popdown("delete-entity-dialog")
        b.wait_not_present(".details-listing tbody[data-id='services/default/mock']")

        b.click(".details-listing tbody[data-id='replicationcontrollers/default/mock'] th")
        b.wait_visible(".details-listing tbody[data-id='replicationcontrollers/default/mock'] .delete-entity")
        b.click(".details-listing tbody[data-id='replicationcontrollers/default/mock'] .delete-entity")
        b.wait_popup("delete-entity-dialog")
        b.click("#delete-entity-button")
        b.wait_popdown("delete-entity-dialog")
        b.wait_not_present(".details-listing tbody[data-id='replicationcontrollers/default/mock']")

        b.click(".details-listing tbody[data-id='pods/default/"+podl[0]+"'] th")
        b.wait_visible(".details-listing tbody[data-id='pods/default/"+podl[0]+"'] .delete-pod")
        b.click(".details-listing tbody[data-id='pods/default/"+podl[0]+"'] .delete-pod")
        b.wait_popup("delete-pod-dialog")
        b.click("#delete-pod-button")
        b.wait_popdown("delete-pod-dialog")
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
        b.wait_popup("deploy-app-dialog")
        b.upload_file("#deploy-app-manifest-file", os.path.join(base_dir, "files/mock-k8s-tiny-app.json"))
        b.wait_val("#deploy-app-namespace", "")
        b.set_val("#deploy-app-namespace", "mynamespace1")
        self.assertEqual(b.text("#deploy-app-namespace-group ul"), "default")
        b.dialog_complete("#deploy-app-dialog")
        b.wait_in_text("#service-list", "mynamespace1")
        b.wait_in_text("#service-list", "default")

        # Fail deploy via dialog
        b.click("#deploy-app")
        b.wait_popup("deploy-app-dialog")
        b.upload_file("#deploy-app-manifest-file", os.path.join(base_dir, "files/mock-k8s-tiny-app.json"))
        b.set_val("#deploy-app-namespace", "!!!!")
        b.dialog_complete("#deploy-app-dialog", result="fail")
        b.dialog_cancel("#deploy-app-dialog")

        # Successfully add node via dialog
        b.click("#add-node")
        b.wait_popup("node-dialog")
        b.set_val("#node-name", "mynode")
        b.set_val("#node-address", "myaddress")
        b.dialog_complete("#node-dialog")
        b.wait_in_text("#node-list", "mynode")
        b.wait_in_text("#node-list", "myaddress")

        # Fail add node via dialog
        b.click("#add-node")
        b.wait_popup("node-dialog")
        b.set_val("#node-name", "!!!!")
        b.set_val("#node-address", "!!!!")
        b.dialog_complete("#node-dialog", result="fail")
        b.dialog_cancel("#node-dialog")

        # Make sure pod has started
        with b.wait_timeout(120):
            b.wait_text("#service-list tr[data-name='mock']:first-of-type td.containers", "1")

        # Adjust the service
        b.click("#services-enable-change")
        b.click("#service-list tr[data-name='mock']:first-of-type button")
        b.wait_popup("adjust-dialog")
        b.set_val("#adjust-dialog input.adjust-replica", 2)
        b.click("#adjust-dialog .btn-primary")
        b.wait_popdown("adjust-dialog")
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
        self.assertEqual(b.text(".details-listing tbody[data-id='services/default/mock'] th"), "mock")
        self.assertIn("Service:", b.attr(".details-listing tbody[data-id='services/default/mock']", "data-key"))
        self.assertEqual(b.text(".details-listing tbody[data-id='replicationcontrollers/default/mock'] th"), "mock")
        b.wait_not_present("#routes")
        b.wait_not_present("#deployment-configs")

        # Click nodes
        b.click(".details-listing tbody[data-id='nodes/127.0.0.1'] th")
        b.wait_present(".details-listing tbody[data-id='nodes/127.0.0.1'] tr.listing-panel")
        self.assertEqual(b.text("tbody[data-id='nodes/127.0.0.1'] tr.listing-panel h3"), "127.0.0.1")
        self.assertFalse(b.is_visible(".details-listing tbody[data-id='nodes/127.0.0.1'] th"))
        b.wait_in_text("tbody[data-id='nodes/127.0.0.1'] tr.listing-panel .status", "Ready")

        b.click(".details-listing tbody[data-id='nodes/mynode'] th")
        b.wait_present(".details-listing tbody[data-id='nodes/mynode'] tr.listing-panel")
        self.assertEqual(b.text("tbody[data-id='nodes/mynode'] tr.listing-panel h3"), "mynode")
        self.assertFalse(b.is_visible(".details-listing tbody[data-id='nodes/mynode'] th"))
        self.assertEqual(b.text("tbody[data-id='nodes/mynode'] tr.listing-panel .status").strip(), "Unknown")

        # Click on the service to expand into a panel
        b.click(".details-listing tbody[data-id='services/default/mock'] th")
        b.wait_present(".details-listing tbody[data-id='services/default/mock'] tr.listing-panel")
        self.assertFalse(b.is_visible(".details-listing tbody[data-id='services/default/mock'] th"))
        self.assertEqual(b.text("tbody[data-id='services/default/mock'] tr.listing-panel h3"), "mock")

        # Now the header and other services should still be present, check filter menu state
        self.assertTrue(b.is_present(".details-listing thead th"))
        self.assertTrue(b.is_present(".details-listing tbody tr.listing-item"))
        self.assertEqual(b.text(".filter-menu li.active"), " View all items ")

        # Click the filter button to make only selected
        b.wait_visible(".filter-menu .btn:first-child")
        b.click(".filter-menu .btn:first-child")
        b.wait_text(".filter-menu li.active", " Only selected items ")
        self.assertFalse(b.is_present(".details-listing thead th"))
        self.assertFalse(b.is_present(".details-listing tbody tr.listing-item"))
        self.assertTrue(b.is_present(".details-listing tr.listing-panel"))

        # Clear the selection via the menu
        b.click(".filter-menu .btn.dropdown-toggle")
        b.click(".filter-menu li:last-child a")
        b.wait_text(".filter-menu li.active", " View all items ")
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
        b.wait_popup("deploy-app-dialog")
        b.upload_file("#deploy-app-manifest-file", os.path.join(base_dir, "files/mock-k8s-tiny-app.json"))
        b.wait_val("#deploy-app-namespace", "mynamespace1")
        b.set_val("#deploy-app-namespace", "mynamespace2")
        b.dialog_complete("#deploy-app-dialog")

        # mynamespace2 is now selected
        b.wait_in_text("#service-list", "mynamespace2")
        b.wait_not_in_text("#service-list", "default")
        b.wait_not_in_text("#service-list", "mynamespace1")
        b.wait_js_cond('window.location.hash == "#/?namespace=mynamespace2"')
        b.wait_in_text(".namespace-filter button", "mynamespace2")

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


class OpenshiftCommonTests(object):

    def testBasic(self):
        m = self.machine
        b = self.browser

        # populate routes
        self.openshift.execute("oc expose service docker-registry --hostname=test.example.com")

        self.login_and_go("/kubernetes")
        b.wait_present("#service-list")
        b.wait_in_text("#service-list", "registry")

        # Switch to images view
        b.click("a[href='#/images']")
        b.wait_present(".images-listing tr[data-id='library/busybox']")
        self.assertEqual(b.text(".images-listing tr[data-id='library/busybox'] th"), "library/busybox")
        b.click(".images-listing tr[data-id='library/busybox']")

        self.assertEqual(b.text(".images-listing tr[data-id='library/busybox'] h3"), "library/busybox")

        header = b.text(".images-listing tr[data-id='library/busybox'] div.listing-head")
        self.assertIn("registry.hub.docker.com", header)

        self.assertEqual(b.text(".images-listing tr[data-id='library/busybox'] h3"), "library/busybox")
        b.wait_in_text(".images-listing tr[data-id='library/busybox'] div.listing-body", "latest")
        b.wait_in_text(".images-listing tr[data-id='library/busybox'] div.listing-body", "amd64")
        b.wait_in_text(".images-listing tr[data-id='library/busybox'] div.listing-body", "busybox@sha")

        # Switch to detail view
        b.click("a[href='#/list']")
        b.wait_present("#content .details-listing")
        b.wait_present("#routes")
        b.wait_present("#deployment-configs")

        b.wait_present(".details-listing tbody[data-id='deploymentconfigs/default/docker-registry'] th")
        self.assertEqual(b.text(".details-listing tbody[data-id='deploymentconfigs/default/docker-registry'] th"), "docker-registry")
        self.assertIn("DeploymentConfig:", b.attr(".details-listing tbody[data-id='deploymentconfigs/default/docker-registry']", "data-key"))

        b.wait_present(".details-listing tbody[data-id='routes/default/docker-registry'] th")
        self.assertEqual(b.text(".details-listing tbody[data-id='routes/default/docker-registry'] th"), "docker-registry")
        self.assertIn("Route:", b.attr(".details-listing tbody[data-id='routes/default/docker-registry']", "data-key"))

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
        b.wait_popup("delete-entity-dialog")
        b.click("#delete-entity-button")
        b.wait_popdown("delete-entity-dialog")
        b.wait_not_present(".details-listing tbody[data-id='routes/default/mock']")

        b.click(".details-listing tbody[data-id='deploymentconfigs/default/frontend'] th")
        b.wait_visible(".details-listing tbody[data-id='deploymentconfigs/default/frontend'] .deployment-delete")
        b.click(".details-listing tbody[data-id='deploymentconfigs/default/frontend'] .deployment-delete")
        b.wait_popup("delete-entity-dialog")
        b.click("#delete-entity-button")
        b.wait_popdown("delete-entity-dialog")
        b.wait_not_present(".details-listing tbody[data-id='deploymentconfigs/default/frontend']")
