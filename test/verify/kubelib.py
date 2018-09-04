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
import subprocess
import re
import sys
import time

import parent

try:
    import testlib
except ImportError:
    from common import testlib

base_dir = os.path.dirname(os.path.realpath(__file__))

__all__ = (
    'KubernetesCase',
    'KubernetesCommonTests',
    'OpenshiftCommonTests',
    'RegistryTests',
)

class KubernetesCase(testlib.MachineCase):
    provision = {
        "machine1": { "address": "10.111.113.1/20" }
    }

    def setUp(self):
        testlib.MachineCase.setUp(self)
        self.browser.wait_timeout(120)

    def stop_kubernetes(self):
        try:
            self.machine.execute('/etc/kubernetes/stop-kubernetes')
        except subprocess.CalledProcessError:
            self.machine.execute("systemctl stop kube-apiserver")

    def start_kubernetes(self):
        # kubelet needs the config to register to the API server
        self.machine.upload(["verify/files/mock-kube-config-basic.json"], "/etc/kubernetes/kubeconfig")
        self.machine.execute("""sed -i '/KUBELET_ARGS=/ { s%"$% --kubeconfig=/etc/kubernetes/kubeconfig"% }' /etc/kubernetes/kubelet""")

        # disable imagefs eviction to protect our docker images
        self.machine.execute("""sed -i '/KUBELET_ARGS=/ { s/"$/ --eviction-hard=imagefs.available<0% --eviction-soft=imagefs.available<0%"/ }' /etc/kubernetes/kubelet""")

        # HACK: These are the default container secrets that which conflict
        # with kubernetes secrets and cause the pod to not start
        self.machine.execute("rm -rf /usr/share/rhel/secrets/* || true")
        self.machine.execute("systemctl start docker || journalctl -u docker")

        # disable swap, newer kubernetes versions don't like it:
        # failed to run Kubelet: Running with swap on is not supported, please disable swap! or set --fail-swap-on flag to false
        self.machine.execute("swapoff --all --verbose")

        self.machine.execute("echo 'KUBE_API_ADDRESS=\"$KUBE_API_ADDRESS --bind-address=10.111.113.1\"' >> /etc/kubernetes/apiserver")
        try:
            self.machine.execute('/etc/kubernetes/start-kubernetes')
        except subprocess.CalledProcessError:
            self.machine.execute("systemctl start etcd kube-apiserver kube-controller-manager kube-scheduler kube-proxy kubelet")

    # HACK: https://github.com/GoogleCloudPlatform/kubernetes/issues/8311
    # Work around for the fact that kube-apiserver doesn't notify about startup
    # We wait until available or timeout.
    def wait_api_server(self, address="127.0.0.1", port=8080, timeout=120, scheme='http'):
        waiter = """
        for a in $(seq 0 {timeout}); do
            if curl -o /dev/null -k -s {scheme}://{address}:{port}; then
                if kubectl get all | grep -q s.*v.*c.*/kubernetes; then
                    exit 0
                fi
            fi
            sleep 0.5
        done
        echo "Timed out waiting for service/kubernetes to appear" >&2
        exit 1
        """.format(**locals())
        self.machine.execute(script=waiter)

class VolumeTests(object):

    def testPendingClaim(self):
        b = self.browser
        m = self.machine

        if hasattr(self, "openshift"):
            m = self.openshift

        self.login_and_go("/kubernetes")
        b.wait_present(".dashboard-status:nth-child(2)")
        b.wait_in_text(".dashboard-status:nth-child(2)", "No volumes in use")
        b.wait_not_present(".pvc-notice a")

        m.upload(["verify/files/mock-volume-tiny-app.json"], "/tmp")
        m.execute("kubectl create -f /tmp/mock-volume-tiny-app.json")

        # By adding another volume claim more issues are found
        m.execute("kubectl create namespace another && kubectl create --namespace=another -f /tmp/mock-volume-tiny-app.json")

        b.wait_present(".pvc-notice a")
        b.wait_in_text(".pvc-notice a", "2")
        b.wait_in_text(".pvc-notice a", "pending volume claims")
        b.click(".pvc-notice a")
        b.wait_present(".pvc-listing")

        b.wait_present("tbody[data-id='default/mock-volume-claim']")
        b.wait_present("tbody[data-id='default/mock-volume-claim'] td:last-child button.btn-danger")
        b.click("tbody[data-id='default/mock-volume-claim'] td:last-child button.btn-danger", force=True)

        b.wait_present("modal-dialog")
        b.wait_in_text("modal-dialog .modal-body", "mock-volume-claim")
        b.wait_present("modal-dialog .modal-body ul")
        b.wait_in_text("modal-dialog .modal-body ul", "mock-volume-")
        b.wait_not_in_text("modal-dialog .modal-body ul", "mock-volume-claim")
        b.click("modal-dialog button.btn-danger")
        b.wait_not_present("modal-dialog")
        b.wait_not_present("tbody[data-id='default/mock-volume-claim']")

        m.execute("kubectl delete rc/mock-volume")
        m.upload(["verify/files/mock-volume-tiny-app.json"], "/tmp")
        m.execute("kubectl create -f /tmp/mock-volume-tiny-app.json")

        b.wait_present("tbody[data-id='default/mock-volume-claim']")
        b.wait_in_text("tbody[data-id='default/mock-volume-claim']", "5Gi")
        b.click("tbody[data-id='default/mock-volume-claim'] tr")

        b.wait_present("modal-dialog")
        b.wait_present("modal-dialog #modify-access-ReadWriteMany:checked")
        b.wait_present("modal-dialog #modify-access-ReadWriteOnce:not(:checked)")
        b.wait_present("modal-dialog #modify-access-ReadOnlyMany:not(:checked)")
        b.wait_val("modal-dialog #modify-capacity", "5Gi")
        b.set_val("modal-dialog #modify-name", "pv1")
        b.set_val("modal-dialog #nfs-modify-server", "10.111.112.101")
        b.set_val("modal-dialog #modify-path", "/nfsexport")
        b.set_val("modal-dialog #modify-policy-Retain", "Retain");
        b.click("modal-dialog .modal-footer button.btn-primary")
        b.wait_not_present("modal-dialog")

        b.wait_present(".pv-listing tbody[data-id='pv1']")

        m.execute("kubectl delete namespace another", timeout=600)
        b.wait_not_present(".pvc-listing")

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

        m.upload(["verify/files/fc-volume.json"], "/tmp")
        m.execute("kubectl create -f /tmp/fc-volume.json")
        b.wait_present(".pv-listing tbody[data-id='fc-volume']")

        b.click(".pv-listing tbody[data-id='pv2'] th")
        b.wait_present(".content-filter")
        b.wait_in_text(".listing-ct-inline", "/tmp")
        b.wait_in_text(".listing-ct-inline", "This volume has not been claimed")
        b.wait_present(".content-filter button.pficon-edit")
        b.click(".content-filter button.pficon-edit")
        b.wait_present("modal-dialog")

        b.wait_not_present("modal-dialog input#modify-name")
        b.wait_in_text("modal-dialog span#modify-name", "pv2")
        b.wait_not_present("modal-dialog input#modify-capacity")
        b.wait_in_text("modal-dialog span#modify-capacity", pv2_size)
        b.wait_not_present("modal-dialog input#modify-path")
        b.wait_in_text("modal-dialog span#modify-path", "/tmp")

        b.click("modal-dialog button.btn-default")
        b.wait_not_present("modal-dialog")

        b.click("a.hidden-xs")
        b.wait_present(".pv-listing tbody[data-id='fc-volume']")
        b.click(".pv-listing tbody[data-id='fc-volume'] th")
        b.wait_present(".content-filter")
        b.wait_present(".content-filter button.btn-delete")
        b.wait_not_present(".content-filter button.pficon-edit")
        b.click(".content-filter button.btn-delete")
        b.wait_present("modal-dialog")
        b.wait_present("modal-dialog .modal-footer button.btn-danger")
        b.click("modal-dialog .modal-footer button.btn-danger")
        b.wait_present(".pv-listing")
        b.wait_not_present(".pv-listing tbody[data-id='fc-volume']")

        base_sel = ".pv-listing tbody[data-id='{}']".format(pv_id)
        b.wait_present(base_sel)
        b.click("{} td.listing-ct-toggle".format(base_sel))
        b.wait_in_text("{} tr.listing-ct-item td:last-child".format(base_sel), "Available")

        m.upload(["verify/files/mock-volume-tiny-app.json"], "/tmp")
        m.execute("kubectl create -f /tmp/mock-volume-tiny-app.json")

        b.wait_in_text("{} tr.listing-ct-item td:last-child".format(base_sel), "Bound")
        b.click("{} .listing-ct-panel ul.nav-tabs li:nth-child(2) a".format(base_sel))
        b.wait_in_text("{} .listing-ct-panel".format(base_sel), "mock-volume-claim")
        b.wait_in_text("{} .listing-ct-panel ".format(base_sel), "default / mock-volume")

        pods = m.execute('kubectl get pods --output=template --template="{{ range .items }}{{.metadata.name}}|{{ end }}"')
        pod = [ x for x in pods.split("|") if x.startswith("mock-volume")][0]
        pod_id = "pods/default/{}".format(pod)

        b.click("a[href='#/list']")
        b.wait_present("#content .details-listing")
        b.wait_present("#content .details-listing tbody[data-id='{}']".format(pod_id))
        b.click("#content .details-listing tbody[data-id='{}'] td.listing-ct-toggle".format(pod_id))
        b.wait_present(".listing-ct-panel ul.nav-tabs")
        b.click(".listing-ct-panel ul.nav-tabs li:last-child a".format(pod_id))
        b.wait_present(".listing-ct-body")
        b.wait_js_func("ph_count_check", ".listing-ct-body div.well", 2)

        volumes = m.execute('kubectl get pods/%s --output=template --template="{{ range .spec.volumes }}{{.name}}|{{ end }}"' % pod)
        secret = [ x for x in volumes.split("|") if x.startswith("default-token")][0]

        b.wait_in_text(".listing-ct-body div[data-id='{}']".format(secret), "Secret")
        b.wait_in_text(".listing-ct-body div[data-id='{}']".format(secret), "mock-volume-container")
        b.wait_in_text(".listing-ct-body div[data-id='{}']".format(secret), "/var/run/secrets/kubernetes.io/serviceaccount")
        b.wait_present(".listing-ct-body div[data-id='host-tmp']")
        b.wait_in_text(".listing-ct-body div[data-id='host-tmp']", "Persistent Volume Claim")
        b.wait_in_text(".listing-ct-body div[data-id='host-tmp']", "mock-volume-claim")
        b.wait_in_text(".listing-ct-body div[data-id='host-tmp']", "mock-volume-container")
        b.wait_in_text(".listing-ct-body div[data-id='host-tmp']", "/mount-path-tmp")
        b.wait_present(".listing-ct-body div[data-id='host-tmp'] a[href='#/volumes/{}']".format(pv_id))

class KubernetesCommonTests(VolumeTests):

    def add_node(self, b, name, address):
        b.wait_present("modal-dialog")
        b.set_val("#node-name", name)
        b.set_val("#node-address", address)
        b.click("modal-dialog .btn-primary")
        b.wait_not_present("modal-dialog .dialog-wait-ct")
        b.wait_not_present("modal-dialog")

    def check_logs(self, b):
        # Check that container log output shows up
        b.click("#content .containers-listing tbody:first-of-type tr.listing-ct-item td.listing-ct-toggle")
        b.wait_in_text("#content .containers-listing tbody.open tr.listing-ct-item td:last-child", "running")
        b.wait_present("tbody.open .listing-ct-panel")
        b.click("tbody.open .listing-ct-panel .listing-ct-head li a.logs")
        b.wait_present("tbody.open .listing-ct-panel pre")
        b.wait_visible("tbody.open .listing-ct-panel pre")
        b.wait_in_text("tbody.open .listing-ct-panel pre", "HelloMessage.")

    def check_shell(self, b):
        b.wait_present("tbody.open .listing-ct-panel .listing-ct-head li a.shell")
        b.click("tbody.open .listing-ct-panel .listing-ct-head li a.shell")
        b.wait_present("tbody.open .listing-ct-panel div.terminal")
        b.wait_visible("tbody.open .listing-ct-panel div.terminal")
        b.wait_in_text("tbody.open .listing-ct-panel div.terminal", "#")
        b.focus('tbody.open .listing-ct-panel .terminal')
        b.key_press("whoami\r")
        b.wait_in_text("tbody.open .listing-ct-panel div.terminal", "root")

    def testDelete(self):
        b = self.browser
        m = self.machine
        b.wait_timeout(120)

        self.login_and_go("/kubernetes")
        b.wait_present("#node-list")
        b.wait_in_text("#node-list", "127.0.0.1")

        m.execute("kubectl create -f /tmp/mock-k8s-tiny-app.json")
        b.wait_in_text("#service-list", "mock")

        b.click("a[href='#/list']")
        b.wait_present("#content .details-listing")
        b.wait_present("#content .details-listing tbody[data-id='services/default/mock']")
        self.assertEqual(b.text(".details-listing tbody[data-id='services/default/mock'] th"), "mock")
        b.wait_present("#content .details-listing tbody[data-id='replicationcontrollers/default/mock']")
        self.assertEqual(b.text(".details-listing tbody[data-id='replicationcontrollers/default/mock'] th"), "mock")
        b.wait_present(".details-listing tbody[data-id^='pods/default/'] th")
        podl = m.execute('kubectl get pods --output=template --template="{{ range .items }}{{.metadata.name}}|{{ end }}"').split("|")
        b.wait_present(".details-listing tbody[data-id='pods/default/"+podl[0]+"'] th")
        self.assertEqual(b.text(".details-listing tbody[data-id='pods/default/"+podl[0]+"'] th"), podl[0])

        b.click(".details-listing tbody[data-id='services/default/mock'] td.listing-ct-toggle")
        b.wait_visible(".details-listing tbody[data-id='services/default/mock'] .delete-entity")
        b.click(".details-listing tbody[data-id='services/default/mock'] .delete-entity")
        b.wait_present("modal-dialog")
        b.click("modal-dialog .btn-danger")
        b.wait_not_present("modal-dialog")
        b.wait_not_present(".details-listing tbody[data-id='services/default/mock']")

        b.click(".details-listing tbody[data-id='replicationcontrollers/default/mock'] td.listing-ct-toggle")
        b.wait_visible(".details-listing tbody[data-id='replicationcontrollers/default/mock'] .delete-entity")
        b.click(".details-listing tbody[data-id='replicationcontrollers/default/mock'] .delete-entity")
        b.wait_present("modal-dialog")
        b.click("modal-dialog .btn-danger")
        b.wait_not_present("modal-dialog")
        b.wait_not_present(".details-listing tbody[data-id='replicationcontrollers/default/mock']")

        b.click(".details-listing tbody[data-id='pods/default/"+podl[0]+"'] td.listing-ct-toggle")
        b.wait_visible(".details-listing tbody[data-id='pods/default/"+podl[0]+"'] .delete-pod")
        b.click(".details-listing tbody[data-id='pods/default/"+podl[0]+"'] .delete-pod")
        b.wait_present("modal-dialog")
        b.wait_in_text("modal-dialog .modal-body", "Deleting a Pod will")
        b.click("modal-dialog .btn-danger")
        b.wait_not_present("modal-dialog")
        b.wait_not_present(".details-listing tbody[data-id='pods/default/"+podl[0]+"']")

    def testDashboard(self):
        m = self.machine
        b = self.browser

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
        b.wait_not_present("modal-dialog .dialog-wait-ct")
        b.wait_not_present("modal-dialog")
        b.wait_in_text("#service-list", "mynamespace1")
        b.wait_in_text("#service-list", "default")

        # Fail deploy via dialog
        b.click("#deploy-app")
        b.wait_present("modal-dialog")
        b.upload_file("#deploy-app-manifest-file", os.path.join(base_dir, "files/mock-k8s-tiny-app.json"))
        b.set_val("#deploy-app-namespace", "!!!!")
        b.click("modal-dialog .btn-primary")
        b.wait_not_present("modal-dialog .dialog-wait-ct")
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
        b.wait_not_present("modal-dialog .dialog-wait-ct")
        b.wait_present("modal-dialog .dialog-error")
        b.click("modal-dialog .btn-cancel")
        b.wait_not_present("modal-dialog")

        # Make sure pod has started
        b.wait_text("#service-list tr[data-name='mock']:first-of-type td.containers", "1")

        # Adjust the service
        b.click("#services-enable-change")
        b.click("#service-list tr[data-name='mock']:first-of-type button")
        b.wait_present("modal-dialog")
        b.set_val("modal-dialog input.adjust-replica", 2)
        b.click("modal-dialog .btn-primary")
        b.wait_not_present("modal-dialog .dialog-wait-ct")
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
        self.assertEqual(b.text(".details-listing tbody[data-id='replicationcontrollers/default/mock'] tr.listing-ct-item th"), "mock")
        b.wait_not_present("#routes")
        b.wait_not_present("#deployment-configs")

        # Click on the service to expand into a panel
        b.click(".details-listing tbody[data-id='services/default/mock'] td.listing-ct-toggle")
        b.wait_present(".details-listing tbody[data-id='services/default/mock'] tr.listing-ct-panel")
        b.wait_visible(".details-listing tbody[data-id='services/default/mock'] tr.listing-ct-panel")
        b.wait_in_text(".details-listing tbody[data-id='services/default/mock'] tr.listing-ct-panel", "mock")

        # Other services should still be present
        self.assertTrue(b.is_present(".details-listing tbody:not(.open) tr.listing-ct-item"))

        # Click into service
        b.click(".details-listing tbody[data-id='services/mynamespace1/mock'] tr.listing-ct-item")
        b.wait_in_text(".listing-ct-inline", "Service")
        b.wait_in_text(".listing-ct-inline", "Endpoints")
        b.wait_present(".content-filter h3")
        b.wait_text(".content-filter h3", "mock")
        b.click("a.hidden-xs")
        b.wait_present("#content .details-listing")
        b.wait_present(".details-listing tbody[data-id='services/mynamespace1/mock']")
        b.wait_not_present("#pods")
        b.wait_not_present("#replication-controllers")

        b.wait_in_text(".type-filter button", "Services")
        b.click(".type-filter .btn.dropdown-toggle")
        b.click(".type-filter li:first-child a")
        b.wait_present("#pods")
        b.wait_present("#replication-controllers")

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
        b.wait_not_present("modal-dialog .dialog-wait-ct")
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

        b.wait_present(".listing-ct-inline")
        b.wait_in_text(".listing-ct-inline", "Node")
        b.wait_in_text(".listing-ct-inline", "Capacity")
        b.wait_present(".content-filter h3")
        b.wait_text(".content-filter h3", "127.0.0.1")
        b.click("a.hidden-xs")

        # Add some nodes
        b.wait_present(".nodes-listing")
        b.wait_present("#add-node")

        for l in ['a', 'b', 'c', 'd']:
            b.click("#add-node")
            self.add_node(b, "{}-mynode".format(l), "{}-myaddress".format(l))
            b.wait_present(".nodes-listing tbody[data-id='{}-mynode']".format(l))

        # Check inner page
        b.wait_present(".nodes-listing tbody[data-id='a-mynode'] tr.listing-ct-item")
        b.click(".nodes-listing tbody[data-id='a-mynode'] tr.listing-ct-item")
        b.wait_present(".content-filter h3")
        b.wait_text(".content-filter h3", "a-mynode")
        b.click("a.hidden-xs")

        # Delete from inner page
        b.wait_present(".nodes-listing")
        b.wait_present(".nodes-listing tbody[data-id='a-mynode'] tr.listing-ct-item")
        b.click(".nodes-listing tbody[data-id='a-mynode'] tr.listing-ct-item")
        b.wait_present(".content-filter button.btn-danger")
        b.click(".content-filter button.btn-danger")
        b.wait_present("modal-dialog")
        b.wait_in_text("modal-dialog", "a-mynode")
        b.click("modal-dialog .btn-danger")
        b.wait_not_present("modal-dialog .dialog-wait-ct")
        b.wait_not_present("modal-dialog")
        b.wait_present(".nodes-listing")
        b.wait_present(".nodes-listing tbody[data-id='127.0.0.1']")
        b.wait_not_present(".nodes-listing tbody[data-id='a-mynode']")

        # Check panel
        b.click(".nodes-listing tbody[data-id='127.0.0.1'] tr.listing-ct-item td.listing-ct-toggle")
        b.wait_present(".nodes-listing tbody[data-id='127.0.0.1'] tr.listing-ct-panel")
        self.assertTrue(b.is_visible(".nodes-listing tbody[data-id='127.0.0.1'] tr.listing-ct-panel"))
        b.wait_in_text("tbody[data-id='127.0.0.1'] tr.listing-ct-panel", "Ready")
        b.wait_present(".nodes-listing tbody[data-id='127.0.0.1'] tr.listing-ct-panel a.machine-jump")
        b.click(".nodes-listing tbody[data-id='127.0.0.1'] tr.listing-ct-panel a.machine-jump")

        is_docker = m.execute("docker ps | grep 'cockpit/kubernetes' || true")
        # When running as a container, localhost only has kubernetes
        if is_docker:
            b.wait_present(".dashboard-cards")
            b.wait_present("a[href='#/nodes']")
            b.click("a[href='#/nodes']")
        # Normally it goes to system
        else:
            b.enter_page("/system")
            b.switch_to_top()
            b.click("li.dashboard-link a[href='/kubernetes']")
            b.enter_page("/kubernetes")

        # Delete from panel
        b.wait_present(".nodes-listing tbody[data-id='b-mynode']")
        b.click(".nodes-listing tbody[data-id='b-mynode'] tr.listing-ct-item td.listing-ct-toggle")
        b.wait_present(".nodes-listing tbody[data-id='b-mynode'] tr.listing-ct-panel")
        self.assertTrue(b.is_visible(".nodes-listing tbody[data-id='b-mynode'] tr.listing-ct-panel"))
        b.wait_in_text("tbody[data-id='b-mynode'] tr.listing-ct-panel", "Unknown")
        b.click("tbody[data-id='b-mynode'] .listing-ct-actions button.btn-delete")
        b.wait_present("modal-dialog")
        b.wait_in_text("modal-dialog", "b-mynode")
        b.click("modal-dialog .btn-danger")
        b.wait_not_present("modal-dialog .dialog-wait-ct")
        b.wait_not_present("modal-dialog")
        b.wait_not_present(".nodes-listing tbody[data-id='b-mynode']")

        # Delete multiple
        b.wait_present(".nodes-listing")
        b.wait_present(".content-filter button.fa-check")
        b.click(".content-filter button.fa-check")
        b.wait_present(".content-filter button.fa-check.active")
        b.wait_present(".content-filter button.btn-danger.disabled")
        b.wait_present("tbody[data-id='c-mynode'] td.listing-ct-toggle input[type=checkbox]")
        b.click("tbody[data-id='c-mynode'] td.listing-ct-toggle input[type=checkbox]")
        b.wait_not_present(".content-filter button.btn-danger.disabled")
        b.wait_present(".content-filter button.btn-danger")
        b.click("tbody[data-id='c-mynode'] td.listing-ct-toggle input[type=checkbox]")
        b.wait_present(".content-filter button.btn-danger.disabled")
        b.click("tbody[data-id='c-mynode'] td.listing-ct-toggle input[type=checkbox]")
        b.wait_present("tbody[data-id='d-mynode'] td.listing-ct-toggle input[type=checkbox]")
        b.click("tbody[data-id='d-mynode'] td.listing-ct-toggle input[type=checkbox]")
        b.click(".content-filter button.btn-danger")
        b.wait_present("modal-dialog")
        b.wait_in_text("modal-dialog", "c-mynode")
        b.wait_in_text("modal-dialog", "d-mynode")
        b.wait_not_in_text("modal-dialog", "127.0.0.1")
        b.click("modal-dialog .btn-cancel")
        b.wait_not_present("modal-dialog")

        b.click(".content-filter button.btn-danger")
        b.wait_present("modal-dialog")
        b.wait_in_text("modal-dialog", "c-mynode")
        b.wait_in_text("modal-dialog", "d-mynode")
        b.click("modal-dialog .btn-danger")
        b.wait_not_present("modal-dialog .dialog-wait-ct")
        b.wait_not_present("modal-dialog")
        b.wait_not_present(".nodes-listing tbody[data-id='c-mynode']")
        b.wait_not_present(".nodes-listing tbody[data-id='d-mynode']")
        b.wait_present(".nodes-listing tbody[data-id='127.0.0.1']")

    def testTopology(self):
        m = self.machine
        b = self.browser

        # The service has loaded and containers instantiated
        self.login_and_go("/kubernetes")
        m.execute("kubectl create -f /tmp/mock-k8s-tiny-app.json")
        b.wait_present("#service-list tr[data-name='mock'] td.containers")
        b.wait_text("#service-list tr[data-name='mock'] td.containers", "1")

        # Switch to topology view
        b.click("a[href='#/topology']")

        # Assert that at least one link between Service and Pod has loaded
        b.wait_present("svg line.ServicePod")

        # Make sure that details display works
        b.wait_present("svg g.Node")
        b.wait_js_func(
            """(function() {
                var el = ph_select("svg g.Node");
                var i;
                for (i = 0; i < el.length; i++) {
                    var x = el[i].getAttribute("cx");
                    var y = el[i].getAttribute("cy");
                    if (x && y) {
                        var ev = document.createEvent("MouseEvent");
                        ev.initMouseEvent(
                            "mousedown",
                            true /* bubble */, true /* cancelable */,
                            window, null,
                            0, 0, 0, 0, /* coordinates */
                            false, false, false, false, /* modifier keys */
                            0 /*left*/, null);

                        /* Now dispatch the event */
                        el[i].dispatchEvent(ev);
                        return true;
                    }
                }

            })""", "true")

        b.wait_present("div.sidebar-pf-right")
        b.wait_present("div.sidebar-pf-right kubernetes-object-describer")
        b.wait_in_text("div.sidebar-pf-right kubernetes-object-describer", "127.0.0.1")
        b.wait_in_text("div.sidebar-pf-right kubernetes-object-describer h3:first", "Node")

class OpenshiftCommonTests(VolumeTests):

    def testBasic(self):
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
        b.wait_present("tbody[data-id='marmalade/busybee']")
        b.wait_in_text("tbody[data-id='marmalade/busybee'] tr", "0.x")

        # Switch to topology view
        b.click("a[href='#/topology']")
        b.wait_present("svg line.DeploymentConfigReplicationController")
        b.wait_present("svg line.RouteService")

    def testDelete(self):
        b = self.browser

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

        b.click(".details-listing tbody[data-id='routes/default/mock'] td.listing-ct-toggle")
        b.wait_visible(".details-listing tbody[data-id='routes/default/mock'] .route-delete")
        b.click(".details-listing tbody[data-id='routes/default/mock'] .route-delete")
        b.wait_present("modal-dialog")
        b.wait_in_text("modal-dialog .modal-header", "Delete Route")
        b.wait_in_text("modal-dialog .modal-body", "Route 'mock'")
        b.click(".modal-footer button.btn-danger")
        b.wait_not_present("modal-dialog")
        b.wait_not_present(".details-listing tbody[data-id='routes/default/mock']")

        b.click(".details-listing tbody[data-id='deploymentconfigs/default/frontend']  td.listing-ct-toggle")
        b.wait_visible(".details-listing tbody[data-id='deploymentconfigs/default/frontend'] .deployment-delete")
        b.click(".details-listing tbody[data-id='deploymentconfigs/default/frontend'] .deployment-delete")
        b.wait_present("modal-dialog")
        b.click(".modal-footer button.btn-danger")
        b.wait_not_present("modal-dialog")
        b.wait_not_present(".details-listing tbody[data-id='deploymentconfigs/default/frontend']")

    def testNodeNavigation(self):
        m = self.machine
        b = self.browser

        # Delete lang.sh to avoid weirdly truncated setlocale journal messages
        self.openshift.execute("rm /etc/profile.d/lang.sh")

        # Make sure we can find openshift
        m.execute("echo '10.111.112.101  f1.cockpit.lan' >> /etc/hosts")

        self.login_and_go("/kubernetes")
        b.wait_present("a[href='#/nodes']")
        b.click("a[href='#/nodes']")

        b.wait_present(".nodes-listing tbody[data-id='f1.cockpit.lan']")
        b.wait_in_text(".nodes-listing tbody[data-id='f1.cockpit.lan'] tr.listing-ct-item", "Ready")

        b.click(".nodes-listing tbody[data-id='f1.cockpit.lan'] tr.listing-ct-item td.listing-ct-toggle")
        b.wait_present(".nodes-listing tbody[data-id='f1.cockpit.lan'] tr.listing-ct-panel")
        self.assertTrue(b.is_visible(".nodes-listing tbody[data-id='f1.cockpit.lan'] tr.listing-ct-panel"))
        b.wait_in_text(".nodes-listing tbody[data-id='f1.cockpit.lan'] tr.listing-ct-panel", "10.111.112.101")
        b.wait_present(".nodes-listing tbody[data-id='f1.cockpit.lan'] tr.listing-ct-panel a.machine-jump")
        b.click(".nodes-listing tbody[data-id='f1.cockpit.lan'] tr.listing-ct-panel a.machine-jump")

        b.switch_to_top()
        # the troubleshoot button by itself shows/hides multiple times, wait for "Connecting.." to disappear first
        b.wait_not_visible(".curtains-ct .spinner")
        b.wait_visible("#machine-troubleshoot")
        b.click('#machine-troubleshoot')
        b.wait_popup('troubleshoot-dialog')
        b.wait_in_text('#troubleshoot-dialog', "Fingerprint")

        # We can accept the key
        b.click("#troubleshoot-dialog .btn-primary")
        b.wait_in_text("#troubleshoot-dialog", 'Log in to')
        b.wait_present("#troubleshoot-dialog .modal-footer .btn-default")
        b.click("#troubleshoot-dialog .modal-footer .btn-default")
        b.wait_in_text(".curtains-ct", "Login failed")

        # Refreshing keeps our key
        b.reload()
        b.wait_visible("#machine-troubleshoot")
        b.wait_in_text(".curtains-ct", "Login failed")
        b.wait_visible('#machine-troubleshoot')
        b.click('#machine-troubleshoot')
        b.wait_popup('troubleshoot-dialog')
        b.wait_in_text("#troubleshoot-dialog", 'Log in to')
        b.wait_present("#login-type button")
        b.click("#login-type button");
        b.click("#login-type li[value=password] a");
        b.wait_in_text("#login-type button span", "Type a password");
        b.wait_visible("#login-diff-password")
        b.wait_not_visible("#login-available")
        self.assertEqual(b.val("#login-custom-password"), "")
        self.assertEqual(b.val("#login-custom-user"), "")
        b.set_val("#login-custom-user", "root")
        b.set_val("#login-custom-password", "foobar")
        b.click('#troubleshoot-dialog .btn-primary')
        b.wait_popdown('troubleshoot-dialog')

        b.wait_not_visible(".curtains-ct")
        b.enter_page('/system', "root@10.111.112.101")
        b.wait_present('#system_information_os_text')
        b.wait_visible('#system_information_os_text')
        b.wait_text_not("#system_information_os_text", "")
        b.logout()

        # Nothing was saved
        self.assertFalse(m.execute("grep 10.111.112.101 /etc/ssh/ssh_known_hosts || true"))
        self.assertFalse(m.execute("grep 10.111.112.101 /etc/cockpit/machines.d/99-webui.json || true"))

        self.allow_hostkey_messages()
        self.allow_journal_messages('/usr/libexec/cockpit-pcp: bridge was killed: .*',
                                    '.* host key for server is not known: .*',
                                    'invalid or unusable locale: .*',
                                    'connection unexpectedly closed by peer',
                                    'Error receiving data: Connection reset by peer')


class RegistryTests(object):
    def setupDockerRegistry(self):
        """Run a docker registry instance and populate it

        The OpenShift registry can pull image streams from localhost:5555 for
        testing.
        """
        # set up a docker registry with cert, as openshift registry expects https
        self.openshift.execute("docker run -d -p 5555:5000 --name testreg "
                               "-v /openshift.local.config/master/:/certs "
                               "-e REGISTRY_HTTP_TLS_CERTIFICATE=/certs/master.server.crt "
                               "-e REGISTRY_HTTP_TLS_KEY=/certs/master.server.key "
                               "registry:2")
        self.openshift.execute("while ! curl -s --connect-timeout 1 https://localhost:5555/; do sleep 1; done")
        self.addCleanup(self.openshift.execute, "docker rm -f testreg")

        # populate it with some images
        self.openshift.execute("docker tag registry:5000/marmalade/juggs:latest localhost:5555/juggs:latest; "
                               "docker tag registry:5000/marmalade/juggs:2.11 localhost:5555/juggs:2.11; "
                               "docker push localhost:5555/juggs")

    def testImages(self):
        b = self.browser
        o = self.openshift

        self.login_and_go(self.registry_root)
        b.wait_present(".dashboard-images")

        # The default view should be overwhelmed with pizzazz images
        b.wait_in_text(".card-pf-wide.dashboard-images", "pizzazz/monster")
        b.wait_not_in_text(".card-pf-wide.dashboard-images", "default/busybox")
        b.wait_not_in_text(".card-pf-wide.dashboard-images", "marmalade/busybee")
        b.wait_not_in_text(".card-pf-wide.dashboard-images", "marmalade/juggs")
        b.wait_not_in_text(".card-pf-wide.dashboard-images", "marmalade/origin")

        # Filter the dashboard to marmalide project
        b.click(".dashboard-images .namespace-filter button")
        b.wait_visible(".dashboard-images .namespace-filter .dropdown-menu")
        b.wait_present(".dashboard-images .namespace-filter a[value='marmalade']")
        b.click(".dashboard-images .namespace-filter a[value='marmalade']")
        b.wait_not_in_text(".card-pf-wide.dashboard-images", "pizzazz/")
        b.wait_in_text(".card-pf-wide.dashboard-images", "marmalade/busybee")

        # Lets navigate to an image stream
        b.click("a[href='#/images/marmalade/busybee']")
        b.wait_in_text(".content-filter h3", "marmalade/busybee")
        b.click("tbody[data-id='marmalade/busybee:0.x'] tr td.listing-ct-toggle")
        b.wait_present("tbody[data-id='marmalade/busybee:0.x'] .listing-ct-panel dl.registry-image-tags")
        b.wait_in_text("tbody[data-id='marmalade/busybee:0.x'] .listing-ct-panel dl.registry-image-tags", "marmalade/busybee:0.x")

        # Look at the image layers
        b.click(".listing-ct-head li:last-child a")
        b.wait_present(".listing-ct-body .registry-image-layers")
        b.wait_visible(".listing-ct-body .registry-image-layers")
        b.wait_in_text(".listing-ct-body .registry-image-layers", "KiB")

        # Add postgres into the stream
        output = o.execute("oc get imagestream --namespace=marmalade --template='{{.spec}}' busybee")
        self.assertNotIn("postgres", output)
        b.click(".pficon-edit")
        b.wait_present("modal-dialog")
        b.wait_visible("#imagestream-modify-populate")
        b.click("#imagestream-modify-populate button")
        b.wait_visible("#imagestream-modify-populate .dropdown-menu")
        b.click("#imagestream-modify-populate a[value='pull']")
        b.wait_visible("#imagestream-modify-pull")
        b.set_val("#imagestream-modify-pull", "postgres")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")
        b.wait_in_text ("#content", "postgres")
        output = o.execute("oc get imagestream --namespace=marmalade --template='{{.spec}}' busybee")
        self.assertIn("postgres", output)

        # Remove postgres from the stream
        b.click(".pficon-edit")
        b.wait_present("modal-dialog")
        b.wait_visible("#imagestream-modify-populate")
        b.click("#imagestream-modify-populate button")
        b.wait_visible("#imagestream-modify-populate .dropdown-menu")
        b.click("#imagestream-modify-populate a[value='none']")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")
        b.wait_not_in_text ("#content", "postgres")
        output = o.execute("oc get imagestream --namespace=marmalade --template='{{.spec}}' busybee")
        self.assertNotIn("postgres", output)

        # Go to the images view and create a new imagestream
        b.click("#content a[href='#/images/marmalade']")
        b.wait_present("a i.pficon-add-circle-o")
        b.click("a i.pficon-add-circle-o")
        b.wait_present("modal-dialog")
        b.wait_visible("#imagestream-modify-name")
        b.set_val("#imagestream-modify-name", "zero")
        b.wait_val("#imagestream-modify-project-text", "marmalade")
        b.click("#imagestream-modify-project button")
        b.wait_visible("#imagestream-modify-project .dropdown-menu")
        b.click("#imagestream-modify-project a[value='default']")
        b.wait_val("#imagestream-modify-project-text", "default")
        b.set_val("#imagestream-modify-project-text", "###")
        b.click(".btn-primary")
        b.wait_visible(".dialog-error")
        b.set_val("#imagestream-modify-project-text", "default")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")

        # Switch to the default namespace and look for what we created
        b.click("filter-bar .namespace-filter button")
        b.wait_visible("filter-bar .namespace-filter .dropdown-menu")
        b.click("filter-bar .namespace-filter a[value='default']")
        b.wait_visible("tbody[data-id='default/zero']")

        # Go to the images view and check annotations
        b.wait_present("tbody[data-id='default/busybox']")
        b.click("tbody[data-id='default/busybox'] th")
        b.wait_present(".content-filter h3")
        b.wait_in_text(".content-filter h3", "default/busybox")
        b.wait_in_text("#content", "Annotations")
        b.wait_in_text("registry-imagestream-meta", "openshift.io/image.dockerRepositoryCheck")

        # Delete the tagged image from its own screen
        b.go("#/images/marmalade/busybee:0.x")
        b.wait_in_text(".content-filter h3", "marmalade/busybee:0.x")
        b.click(".pficon-delete")
        b.wait_present("modal-dialog")
        b.click("modal-dialog .btn-danger")
        b.wait_not_present("modal-dialog")

        # Should redirect to the imagestream page
        b.wait_in_text(".content-filter", "Show all image streams")
        b.wait_not_in_text("#content", "0.x")

        # Delete via the main UI
        b.wait_present("tbody[data-id='marmalade/busybee:latest']")
        b.click("tbody[data-id='marmalade/busybee:latest'] tr.listing-ct-item td.listing-ct-toggle")
        b.wait_present("tbody[data-id='marmalade/busybee:latest'] .listing-ct-panel dl.registry-image-tags")
        b.wait_in_text("tbody[data-id='marmalade/busybee:latest'] .listing-ct-panel dl.registry-image-tags", "marmalade/busybee:latest")
        b.click("tbody[data-id='marmalade/busybee:latest'] .listing-ct-head .pficon-delete")
        b.wait_present("modal-dialog")
        b.click("modal-dialog .btn-danger")
        b.wait_not_present("modal-dialog")

        # All tags here have been removed
        b.wait_not_in_text("#content", "latest")

        # Show the image on the right screen
        b.go("#/images/marmalade/juggs")
        b.wait_in_text(".content-filter h3", "marmalade/juggs")
        b.wait_present("tbody[data-id='marmalade/juggs:2.9']")
        b.click("tbody[data-id='marmalade/juggs:2.9'] tr.listing-ct-item td.listing-ct-toggle")

        # Various labels should show up in this image
        b.wait_in_text("tbody[data-id='marmalade/juggs:2.9'] .listing-ct-panel", "Juggs Image")
        b.wait_in_text("tbody[data-id='marmalade/juggs:2.9'] registry-image-body", "This is a test description of an image. It can be as long as a paragraph, featuring a nice brogrammer sales pitch.")
        b.wait_in_text("tbody[data-id='marmalade/juggs:2.9'] registry-image-body", "http://hipsum.co")

        # And some key labels shouldn't show up on the metadata
        b.click("tbody[data-id='marmalade/juggs:2.9'] .listing-ct-head li:last-child a")
        b.wait_present("tbody[data-id='marmalade/juggs:2.9'] registry-image-meta")
        b.wait_in_text("tbody[data-id='marmalade/juggs:2.9'] registry-image-meta", "build-date=2016-03-04")

        # Check panel navigations
        b.go("#/images")
        b.wait_present("tbody[data-id='marmalade/juggs']")
        b.wait_in_text("tbody[data-id='marmalade/juggs'] tr", "and 1 other")
        b.wait_present("tbody[data-id='marmalade/juggs'] tr td a.registry-image-tag:contains('2.11')")
        b.click("tbody[data-id='marmalade/juggs'] tr td.listing-ct-toggle")
        b.wait_visible("tbody[data-id='marmalade/juggs'] tr.listing-ct-panel")
        b.wait_present("tbody[data-id='marmalade/juggs'] tr.listing-ct-panel ul li:contains('Tags')")
        b.click("tbody[data-id='marmalade/juggs'] tr.listing-ct-panel ul li:contains('Tags') a")
        b.wait_present("tbody[data-id='marmalade/juggs'] tr.listing-ct-panel td table.listing-ct")
        b.wait_present("tbody[data-id='marmalade/juggs'] tr.listing-ct-panel td table.listing-ct tbody[data-id='marmalade/juggs:latest']")
        b.wait_in_text("tbody[data-id='marmalade/juggs'] tr.listing-ct-panel td table.listing-ct tbody[data-id='marmalade/juggs:latest'] tr th", "latest")
        b.click("tbody[data-id='marmalade/juggs'] tr.listing-ct-panel td table.listing-ct tbody[data-id='marmalade/juggs:latest'] tr")
        b.wait_js_cond('window.location.hash == "#/images/marmalade/juggs:latest"')
        b.wait_present("#content div.listing-ct-inline")
        b.wait_text(".content-filter h3 span", "marmalade/juggs:latest")

        b.go("#/images")
        b.wait_present("tbody[data-id='marmalade/juggs']")
        b.wait_in_text("tbody[data-id='marmalade/juggs'] tr", "and 1 other")
        b.wait_present("tbody[data-id='marmalade/juggs'] tr td a.registry-image-tag:contains('2.11')")
        b.click("tbody[data-id='marmalade/juggs'] tr td a.registry-image-tag:contains('2.11')")
        b.wait_js_cond('window.location.hash == "#/images/marmalade/juggs:2.11"')
        b.wait_present("#content div.listing-ct-inline")
        b.wait_in_text(".content-filter h3", "marmalade/juggs:2.11")

        b.go("#/images")
        b.wait_present("tbody[data-id='marmalade/juggs'] tr")
        b.wait_in_text("tbody[data-id='marmalade/juggs'] tr", "and 1 other")
        b.click("tbody[data-id='marmalade/juggs'] tr")
        b.wait_js_cond('window.location.hash == "#/images/marmalade/juggs"')
        b.wait_present("#content div.listing-ct-inline")
        b.wait_in_text(".content-filter h3", "marmalade/juggs")

    def testImageNames(self):
        b = self.browser

        self.login_and_go(self.registry_root)
        b.wait_present(".dashboard-images")
        b.wait_present("#content a[href='#/images/marmalade']")
        b.click("#content a[href='#/images/marmalade']")
        b.wait_visible("a:contains('New image stream')")

        self.checkImageName(b, "__aaa__", False)
        self.checkImageName(b, "_aaa", False)
        self.checkImageName(b, "-aaa", False)
        self.checkImageName(b, ".aaa", False)
        self.checkImageName(b, "aaa_", False)
        self.checkImageName(b, "aaa-", False)
        self.checkImageName(b, "aaa.", False)
        self.checkImageName(b, "a_ a", False)
        self.checkImageName(b, "Aa_Bb_Cc", False)
        self.checkImageName(b, "aa_bb_cc", True)
        self.checkImageName(b, "aa-bb_cc.dd", True)

    def checkImageName(self, b, name, succeed):
        b.click("a:contains('New image stream')")
        b.wait_present("modal-dialog")
        b.wait_visible("#imagestream-modify-name")
        b.set_val("#imagestream-modify-project-text", "default")

        b.set_val("#imagestream-modify-name", name)
        b.click("modal-dialog .btn-primary")

        if succeed:
            b.wait_not_present("modal-dialog")
        else:
            b.wait_visible(".dialog-error")
            b.click(".btn-cancel")

        b.wait_not_present("modal-dialog")

    def testProjectGroups(self):
        b = self.browser

        self.login_and_go(self.registry_root)
        b.go("#/projects")
        b.wait_present("tbody[data-id='marmalade']")

        # Create a new group
        b.click("#add-group")
        b.wait_present("modal-dialog")
        b.wait_visible(".modal-body")
        b.set_val("#group_name", "Pro-Duction")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")
        b.wait_present("tbody[data-id='marmalade']")

        #group page
        b.click("tbody[data-id='Pro-Duction'] tr:first-child td:nth-of-type(2)")
        b.wait_in_text(".content-filter h3", "Pro-Duction")

        #add member
        b.click("a i.pficon-add-circle-o")
        b.wait_present("modal-dialog")
        b.wait_visible("#add_user_to_group")
        b.click("#add_user_to_group button")
        b.wait_visible("#add_user_to_group .dropdown-menu")
        b.wait_present(".dropdown-menu a[value='scruffy']")
        b.wait_visible(".dropdown-menu a[value='scruffy']")
        b.click(".dropdown-menu a[value='scruffy']")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")

        #delete member
        b.click("tbody[data-id='scruffy'] tr td:last-child a i.pficon-close")
        b.wait_present("modal-dialog")
        b.wait_visible(".modal-body")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")

        b.click("a i.pficon-add-circle-o")
        b.wait_present("modal-dialog")
        b.wait_visible("#add_user_to_group")
        b.click("#add_user_to_group button")
        b.wait_visible("#add_user_to_group .dropdown-menu")
        b.wait_present(".dropdown-menu a[value='scruffy']")
        b.wait_visible(".dropdown-menu a[value='scruffy']")
        b.click(".dropdown-menu a[value='scruffy']")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")

        #delete user
        b.wait_in_text(".content-filter h3", "Pro-Duction")
        b.click(".content-filter .pficon-delete")
        b.wait_present("modal-dialog")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")
        b.wait_not_present("tbody[data-id='Pro-Duction']")

    def testProjectUsers(self):
        o = self.openshift
        b = self.browser

        self.login_and_go(self.registry_root)
        b.go("#/projects")
        o.execute("oc get projects")
        o.execute("oc get rolebinding -n marmalade")
        b.wait_present("tbody[data-id='default']")

        # Create a new project
        b.click("#add-project")
        b.wait_present("modal-dialog")
        b.wait_visible(".modal-body")
        b.wait_visible("#project-new-name")
        b.set_val("#project-new-name", "testprojectuserproj")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")

        #wait for it
        b.wait_present("tbody[data-id='testprojectuserproj']")
        o.execute("oc get projects")

        # Create a new user
        b.click("#add-user")
        b.wait_present("modal-dialog")
        b.wait_visible(".modal-body")
        b.wait_visible("#identities")
        b.set_val("#user_name", "testprojectuser")
        b.set_val("#identities", "anypassword:abc123")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")

        #wait for it
        b.wait_present("tbody[data-id='testprojectuser']")

        #goto user page
        b.click("tbody[data-id='testprojectuser'] tr:first-child td:nth-of-type(2)")
        b.wait_in_text(".content-filter h3", "testprojectuser")

        #modify user
        b.click(".content-filter .pficon-edit")
        b.wait_present("modal-dialog")
        b.wait_visible("#identities")
        b.set_val("#identities", "anypassword:abc1234")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")
        b.wait_in_text("dl.listing-ct-body dd", "anypassword:abc1234")

        #add project member
        b.click("a i.pficon-add-circle-o")
        b.wait_present("modal-dialog")
        b.wait_visible("#add_parent_for_user")
        b.click("#add_parent_for_user button")
        b.wait_visible("#add_parent_for_user .dropdown-menu")
        b.click(".dropdown-menu a[value='testprojectuserproj']")
        b.wait_visible("#add_role_for_user")
        b.click("#add_role_for_user button")
        b.wait_visible("#add_role_for_user .dropdown-menu")
        b.click("#add_role_for_user a[value='Admin']")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")

        #delete project member X
        b.wait_present("tbody[data-id='testprojectuserproj'] tr td:last-child a i.pficon-close")
        b.click("tbody[data-id='testprojectuserproj'] tr td:last-child a i.pficon-close")
        b.wait_present("modal-dialog")
        b.wait_visible(".modal-body")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")

        #add project member again
        b.click("a i.pficon-add-circle-o")
        b.wait_present("modal-dialog")
        b.wait_visible("#add_parent_for_user")
        b.click("#add_parent_for_user button")
        b.wait_visible("#add_parent_for_user .dropdown-menu")
        b.click(".dropdown-menu a[value='testprojectuserproj']")
        b.wait_visible("#add_role_for_user")
        b.click("#add_role_for_user button")
        b.wait_visible("#add_role_for_user .dropdown-menu")
        b.click("#add_role_for_user a[value='Admin']")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")

        #add another role to project member
        b.wait_present("tbody[data-id='testprojectuserproj']")
        b.wait_present("tbody[data-id='testprojectuserproj'] tr .btn-group")
        b.wait_visible("tbody[data-id='testprojectuserproj'] tr .btn-group")
        b.click("tbody[data-id='testprojectuserproj'] tr .btn-group button")
        b.wait_visible("tbody[data-id='testprojectuserproj'] tr .btn-group .dropdown-menu")
        b.click("tbody[data-id='testprojectuserproj'] tr .dropdown-menu a[value='Push']")
        b.wait_present("modal-dialog")
        b.wait_visible(".modal-body")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")
        b.wait_present("table.listing-ct")
        testlib.wait(lambda: re.search(r"registry-editor\s+/registry-editor\s+testprojectuser\b",
                               o.execute("oc get rolebinding -n testprojectuserproj")))

        #delete user
        b.wait_in_text(".content-filter h3", "testprojectuser")
        b.click(".content-filter .pficon-delete")
        b.wait_present("modal-dialog")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")

        # HACK: In order to test issue, log the output to the journal
        testlib.wait(lambda: not re.search(r"\btestprojectuser\b", o.execute("oc get rolebinding -n testprojectuserproj | logger -s 2>&1")))

        #add/remove members for other roles
        b.go("#/projects/testprojectuserproj")
        for (role, perm) in [("Push", "editor"), ("Pull", "viewer")]:
            username = "testprojectuser" + role.lower()
            b.click("a i.pficon-add-circle-o")
            b.wait_present("modal-dialog")
            b.wait_visible("#add_member_name")
            b.set_val("#add_member_name", username)
            b.wait_visible("#add_role")
            b.click("#add_role button")
            b.wait_visible("#add_role .dropdown-menu")
            b.click("#add_role a[value='%s']" % role)
            b.click(".btn-primary")
            b.wait_not_present("modal-dialog")
            b.wait_present("tbody[data-id='%s']" % username)

            testlib.wait(lambda: username in o.execute("oc get rolebinding -n testprojectuserproj"), delay=5)
            output = o.execute("oc get rolebinding -n testprojectuserproj")
            self.assertRegexpMatches(output, "registry-%s\s+/registry-%s\s.*\\b%s\\b" % (perm, perm, username))
            self.assertNotRegexpMatches(output, "registry-admin.*%s" % username)

            b.wait_present("tbody[data-id='%s']" % username)
            b.click("tbody[data-id='%s'] a i.pficon-close" % username)
            b.wait_present("modal-dialog")
            b.click(".btn-primary")
            b.wait_not_present("modal-dialog")
            b.wait_present("table.listing-ct")
            testlib.wait(lambda: username not in o.execute("oc get rolebinding -n testprojectuserproj"), delay=5)

        # try to add user with invalid name from testprojectuserproj page
        b.go("#/projects/testprojectuserproj")
        b.wait_present("a i.pficon-add-circle-o")
        b.click("a i.pficon-add-circle-o")
        b.wait_present("modal-dialog")
        b.wait_visible("#add_member_name")
        b.set_val("#add_member_name", "foo ^ bar")
        b.wait_visible("#add_role")
        b.click("#add_role button")
        b.wait_visible("#add_role .dropdown-menu")
        b.click("#add_role a[value='Admin']")
        b.click(".btn-primary")
        b.wait_in_text(".dialog-error", "The member name contains invalid characters.")

        # but email-style user name should be accepted
        b.set_val("#add_member_name", "foo@bar.com")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")
        b.wait_present("tbody[data-id='foo@bar.com']")
        testlib.wait(lambda: 'foo@bar.com' in o.execute("oc get rolebinding -n testprojectuserproj"), delay=5)
        self.assertNotIn('foo ^ bar', o.execute("oc get rolebinding -n testprojectuserproj"))

        # service accounts should be accepted
        b.wait_present("a i.pficon-add-circle-o")
        b.click("a i.pficon-add-circle-o")
        b.wait_present("modal-dialog")
        b.wait_visible("#add_member_name")
        b.set_val("#add_member_name", "system:janitor:default")
        b.wait_visible("#add_role")
        b.click("#add_role button")
        b.wait_visible("#add_role .dropdown-menu")
        b.click("#add_role a[value='Admin']")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")
        b.wait_present("tbody[data-id='system:janitor:default']")
        testlib.wait(lambda: 'system:janitor:default' in o.execute("oc get rolebinding -n testprojectuserproj"), delay=5)

        # they appear on the "All projects" page too
        b.go("#/projects/")
        b.wait_present("tbody[data-id='foo@bar.com']")
        b.wait_present("tbody[data-id='system:janitor:default']")

        # try to add user with invalid name from "All projects" page
        b.click("#add-user")
        b.wait_present("modal-dialog")
        b.wait_visible(".modal-body")
        b.wait_visible("#identities")
        b.set_val("#user_name", "bar ^ baz")
        b.set_val("#identities", "anypassword:abc123")
        b.click(".btn-primary")
        b.wait_in_text(".dialog-error", "The name contains invalid characters.")

        # email-style user name should be accepted
        b.set_val("#user_name", "bar@baz.com")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")
        b.wait_present("tbody[data-id='bar@baz.com']")

    def testProjectPolicy(self):
        o = self.openshift
        b = self.browser

        self.login_and_go(self.registry_root)
        b.wait_present(".dashboard-images")
        b.go("#/projects")

        #wait for it
        b.wait_present("tbody[data-id='default']")

        # Create a new project
        b.click("#add-project")
        b.wait_present("modal-dialog")
        b.wait_visible(".modal-body")
        b.wait_visible("#project-new-name")
        b.set_val("#project-new-name", "testprojectpolicyproj")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")

        #wait for it
        b.wait_present("tbody[data-id='testprojectpolicyproj']")
        o.execute("oc get projects")

        #goto project page
        b.click("tbody[data-id='testprojectpolicyproj'] tr:first-child td:nth-of-type(2)")
        b.wait_in_text(".content-filter h3", "testprojectpolicyproj")

        #add user with role
        b.wait_present("a i.pficon-add-circle-o")
        b.click("a i.pficon-add-circle-o")
        b.wait_present("modal-dialog")
        b.wait_visible("#add_member_group")
        b.click("#add_member_group button")
        b.wait_visible("#add_member_group .dropdown-menu")
        b.click("#add_member_group a[value='scruffy']")
        b.click("#add_role button")
        b.wait_visible("#add_role .dropdown-menu")
        b.click("#add_role a[value='Admin']")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")

        b.wait_present(".inner-project-listing")
        b.wait_present("a i.pficon-add-circle-o")
        b.click("a i.pficon-add-circle-o")
        b.wait_present("modal-dialog")
        b.wait_visible("#add_member_group")
        b.click(".btn-primary")
        b.wait_present("modal-dialog")
        self.assertEqual(b.text(".dialog-error") ,"Please select a valid Member.")
        b.click(".btn-cancel")
        b.wait_not_present("modal-dialog")

        b.wait_present(".inner-project-listing")
        b.wait_present("a i.pficon-add-circle-o")
        b.click("a i.pficon-add-circle-o")
        b.wait_present("modal-dialog")
        b.wait_visible("#add_member_group")
        b.click("#add_member_group button")
        b.wait_visible("#add_member_group .dropdown-menu")
        b.click("#add_member_group a[value='scruffy']")
        b.click(".btn-primary")
        b.wait_present("modal-dialog")
        self.assertEqual(b.text(".dialog-error") ,"Please select a valid Role.")
        b.click(".btn-cancel")
        b.wait_not_present("modal-dialog")

        # Add a non-existent user
        b.wait_present(".inner-project-listing")
        b.wait_present("a i.pficon-add-circle-o")
        b.click("a i.pficon-add-circle-o")
        b.wait_present("modal-dialog")
        b.wait_visible("#add_member_group")
        b.set_val("#add_member_name", "randomuser")
        b.click("#add_role button")
        b.wait_visible("#add_role .dropdown-menu")
        b.click("#add_role a[value='Admin']")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")

        # Add a non-existent user, negative case
        b.wait_present(".inner-project-listing")
        b.wait_present("a i.pficon-add-circle-o")
        b.click("a i.pficon-add-circle-o")
        b.wait_present("modal-dialog")
        b.wait_visible("#add_member_group")
        b.set_val("#add_member_name", "")
        b.click("#add_role button")
        b.wait_visible("#add_role .dropdown-menu")
        b.click("#add_role a[value='Admin']")
        b.click(".btn-primary")
        b.wait_present("modal-dialog")
        self.assertEqual(b.text(".dialog-error") ,"Please select a valid Member.")
        b.click(".btn-cancel")
        b.wait_not_present("modal-dialog")

    def testProjectAdmin(self):
        o = self.openshift
        b = self.browser

        # Log in as scruffy
        self.setup_user("scruffy", "scruffy")
        self.login_and_go(self.registry_root)

        # Make sure the default view is not visible to non cluster admins
        b.wait_present(".dashboard-images")
        b.wait_visible(".dashboard-images:nth-child(1)")
        b.wait_not_in_text(".card-pf-wide.dashboard-images", "default/busybox")

        # Show that the project displays shared access data
        b.wait_present("tr[data-name='marmalade']")
        b.wait_present("tr[data-name='marmalade'] .fa-lock")

        # Change the project access
        b.go("#/projects/marmalade")
        b.wait_in_text(".content-filter h3", "marmalade")
        b.wait_in_text(".listing-ct-body", "Project access policy only allows specific members to access images. Grant access to specific members below.")
        b.click(".content-filter .pficon-edit")
        b.wait_present("modal-dialog")
        b.wait_visible("#project-access-policy")
        b.wait_in_text("#project-access-policy button", "Private: Allow only specific users or groups to pull images")
        b.click("#project-access-policy button")
        b.wait_visible("#project-access-policy .dropdown-menu")
        b.click("#project-access-policy a[value='shared']")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")
        b.wait_not_in_text(".listing-ct-body", "Project access policy allows all authenticated users to pull images. Grant additional access to specific members below.")
        output = o.execute("oc policy who-can get --namespace=marmalade imagestreams/layers")
        self.assertIn("system:authenticated", output)
        self.assertNotIn("system:unauthenticated", output)

        # Look for change in state
        b.go("#/")
        b.wait_present("tr[data-name='marmalade'] .fa-unlock-alt")

        # Change project to shared
        b.go("#/projects/marmalade")
        b.wait_in_text(".content-filter h3", "marmalade")
        b.click(".content-filter .pficon-edit")
        b.wait_present("modal-dialog")
        b.wait_visible("#project-access-policy")
        b.wait_in_text("#project-access-policy button", "Shared: Allow any authenticated user to pull images")
        b.click("#project-access-policy button")
        b.wait_visible("#project-access-policy .dropdown-menu")
        b.click("#project-access-policy a[value='anonymous']")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")
        b.wait_in_text(".listing-ct-body", "Project access policy allows anonymous users to pull images. Grant additional push or admin access to specific members below.")
        output = o.execute("oc policy who-can get --namespace=marmalade imagestreams/layers")
        self.assertIn("system:unauthenticated", output)

        # Look for change in state
        b.go("#/")
        b.wait_present("tr[data-name='marmalade'] .fa-unlock")

        # New project doesn't exist
        b.go("#/")
        b.wait_present(".dashboard-images")
        output = o.execute("oc get projects")
        self.assertNotIn("llama", output)
        b.wait_not_in_text(".dashboard-images:first-child", "llama")

        # Create a new project
        b.wait_visible("a.new-project-link")
        b.click("a.new-project-link")
        b.wait_present("modal-dialog")
        b.wait_visible("#project-new-name")
        b.set_val("#project-new-name", "invalid...!")
        b.click(".btn-primary")
        b.wait_visible(".dialog-error")
        b.set_val("#project-new-name", "llama")
        b.set_val("#project-new-display", "Display llama")
        b.set_val("#project-new-description", "Description goes here")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")

        # Check that the projcet exists
        b.wait_in_text(".dashboard-images:first-child", "llama")

        # Go and modify the project
        b.go("#/projects")
        b.wait_present("tbody[data-id='llama']")
        b.wait_present("tbody[data-id='llama'] tr.listing-ct-item")
        b.click("tbody[data-id='llama'] tr.listing-ct-item td:nth-of-type(2)")
        b.wait_in_text(".content-filter h3", "Display llama (llama)")
        b.wait_in_text("#content", "Description goes here")
        b.click(".pficon-edit")
        b.wait_present("modal-dialog")
        b.wait_visible("#project-new-display")
        b.set_val("#project-new-display", "What the llama say")
        b.wait_visible("#project-new-description")
        b.set_val("#project-new-description", "Blearrrrrrrrgh")
        b.click(".btn-primary")
        b.wait_not_present("modal-dialog")
        b.wait_in_text(".content-filter h3", "What the llama say (llama)")
        b.wait_in_text("#content", "Blearrrrrrrrgh")

        # Make sure it showed up in the console
        found = False
        i = 0
        while True:
            try:
                output = o.execute("oc get projects")
                if "llama" not in output:
                    if not found:
                        sys.stderr.write(output)
                    found = True
                    raise Exception(output)
                break
            except:
                if i > 60:
                    raise
                i = i + 1
                time.sleep(2)

    def testDockerCommandInfo(self):
        o = self.openshift
        b = self.browser

        # create push and pull user and login as pushuser
        o.execute("oc adm policy add-role-to-user registry-viewer pulluser -n marmalade")
        o.execute("oc adm policy add-role-to-user registry-editor pushuser -n marmalade")
        o.execute("oc adm policy add-role-to-user registry-viewer pushuser -n pizzazz")

        self.setup_user("pushuser", "a")
        self.login_and_go(self.registry_root)

        # always visible on "All projects" page
        b.wait_in_text("body", "Pull an image")
        b.wait_visible('#docker-push-commands')
        b.wait_visible('#docker-pull-commands')

        # push user should not see docker push command on pizzazz overview page (only a viewer there)
        b.wait_visible(".dashboard-images .namespace-filter")
        b.click(".dashboard-images .namespace-filter button")
        b.wait_visible(".dashboard-images .namespace-filter .dropdown-menu")
        b.wait_present(".dashboard-images .namespace-filter a[value='pizzazz']")
        b.click(".dashboard-images .namespace-filter a[value='pizzazz']")
        b.wait_visible('#docker-pull-commands')
        b.wait_not_visible('#docker-push-commands')

        # push user should see docker push and pull commands on marmalade overview page
        b.click(".dashboard-images .namespace-filter button")
        b.wait_visible(".dashboard-images .namespace-filter .dropdown-menu")
        b.wait_present(".dashboard-images .namespace-filter a[value='marmalade']")
        b.click(".dashboard-images .namespace-filter a[value='marmalade']")
        b.wait_visible('#docker-push-commands')

        # .. and also on the image page
        b.go("#/images/marmalade/origin")
        b.wait_in_text("body", "push an image to this image stream")
        b.wait_in_text("body", "docker tag")
        b.wait_in_text("body", "docker push")
        b.wait_visible('.registry-imagestream-push')

        # log in as pulluser
        b.logout()
        self.setup_user("pulluser", "a")
        self.login_and_go(self.registry_root)

        # always visible on "All projects" page
        b.wait_in_text("body", "Pull an image")
        b.wait_visible('#docker-push-commands')
        b.wait_visible('#docker-pull-commands')

        # pull user should only see docker pull command, but not push on project specific overview page
        b.wait_visible(".dashboard-images .namespace-filter")
        b.click(".dashboard-images .namespace-filter button")
        b.wait_visible(".dashboard-images .namespace-filter .dropdown-menu")
        b.wait_present(".dashboard-images .namespace-filter a[value='marmalade']")
        b.click(".dashboard-images .namespace-filter a[value='marmalade']")
        b.wait_visible('#docker-pull-commands')
        b.wait_not_visible('#docker-push-commands')

        # and neither the push command on the image page
        b.go("#/images/marmalade/origin")
        b.wait_in_text("body", "Images")
        b.wait_not_visible('.registry-imagestream-push')

    def testImagestreamImport(self):
        b = self.browser
        self.setupDockerRegistry()

        # Add new "alltags" image stream pulling from localhost:5555/juggs
        self.login_and_go("{}#/images/marmalade".format(self.registry_root))
        b.wait_present("a.pull-right span:contains('New image stream')")
        b.click("a.pull-right")
        b.wait_present("modal-dialog")
        b.wait_val("#imagestream-modify-project-text", "marmalade")
        b.set_val("#imagestream-modify-name", "alltags")
        b.wait_present("#imagestream-modify-populate")
        b.click("#imagestream-modify-populate button")
        b.wait_visible("#imagestream-modify-populate .dropdown-menu")
        b.click("#imagestream-modify-populate .dropdown-menu a[value='pull']")
        b.wait_present("#imagestream-modify-pull")
        b.wait_visible("#imagestream-modify-pull")
        b.set_val("#imagestream-modify-pull", "localhost:5555/juggs")
        b.click("modal-dialog div.modal-footer button.btn-primary")
        b.wait_not_present("modal-dialog")

        # new stream with both "latest" and "2.11" tags should now appear
        b.wait_present("tr.imagestream-item th:contains('marmalade/alltags')")
        b.wait_present('tbody[data-id="marmalade/alltags"]')
        b.wait_in_text('tbody[data-id="marmalade/alltags"] tr', "latest")
        b.wait_in_text('tbody[data-id="marmalade/alltags"] tr', "2.11")

        # also check with CLI
        output = self.openshift.execute("oc get imagestream --namespace=marmalade alltags")
        self.assertIn("localhost:5555/juggs", output)
        self.assertIn("latest", output)
        self.assertIn("2.11", output)

        # Add new "sometags" image stream pulling only the 2.11 tag
        b.click("a.pull-right")
        b.wait_present("modal-dialog")
        b.wait_val("#imagestream-modify-project-text", "marmalade")
        b.wait_js_cond("document.activeElement == document.getElementById('imagestream-modify-name')")
        b.set_val("#imagestream-modify-name", "sometags")
        b.wait_present("#imagestream-modify-populate")
        b.click("#imagestream-modify-populate button")
        b.wait_visible("#imagestream-modify-populate .dropdown-menu")
        b.click("#imagestream-modify-populate .dropdown-menu a[value='tags']")
        b.wait_present("#imagestream-modify-tags")
        b.wait_visible("#imagestream-modify-tags")
        b.set_val("#imagestream-modify-pull", "localhost:5555/juggs")
        # fields.tags is not an <input> element, type manually
        b.click("#imagestream-modify-tags")
        b.focus("#imagestream-modify-tags")
        b.key_press(['2', '.', '1', '1'])
        b.focus("modal-dialog div.modal-footer button.btn-primary")
        b.click("modal-dialog div.modal-footer button.btn-primary")
        b.wait_not_present("modal-dialog")

        # new stream with only "2.11" tags should now appear
        b.wait_present('tbody[data-id="marmalade/sometags"]')
        b.wait_present("tr.imagestream-item th:contains('marmalade/sometags')")
        b.wait_in_text('tbody[data-id="marmalade/sometags"] tr', '2.11')
        b.wait_not_in_text('tbody[data-id="marmalade/sometags"] tr', 'latest')

        # also check with CLI
        testlib.wait(lambda: '2.11' in self.openshift.execute('oc get imagestream --namespace=marmalade sometags'))
        testlib.wait(lambda: 'latest' not in self.openshift.execute('oc get imagestream --namespace=marmalade sometags'))


