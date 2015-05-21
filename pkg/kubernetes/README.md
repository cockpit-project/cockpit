Kubernetes Proof of Concept
---------------------------

This is proof of concept Kubernetes code. It is not yet installed as part
of Cockpit. To use it follow the instructions below. Tested on Fedora 22
and requires an otherwise working latest version of Cockpit.

This sets up a single machine kubernetes master and minion:

    $ sudo yum install kubernetes

Now in order to support the latest v1beta3 API, we need to build kubernetes
from source or use a version later than v0.16.2:

    $ sudo yum install kubernetes
    $ sudo yum install etcd docker

The v1beta3 API is not enabled by default. The kube-apiserver process needs to run
with the --runtime_config=api/v1beta3 argument. Use the following command
to enable it:

    $ sudo sed -i 's|KUBE_API_ARGS="|KUBE_API_ARGS="--runtime_config=api/v1beta3|' /etc/kubernetes/apiserver
    $ sudo sed -i 's|KUBELET_ARGS="|KUBELET_ARGS="--api_servers=127.0.0.1:8080|' /etc/kubernetes/kubelet

Now start kubernetes:

    $ sudo systemctl start docker etcd kube-controller-manager \
         kube-apiserver kube-scheduler kubelet kube-proxy

Enable the kubernetes plugin to Cockpit. For now this is not enabled
by default. Run this as the user with which you will be logging into
Cockpit:

    $ cd /path/to/cockpit
    $ mkdir -p ~/.local/share/cockpit
    $ ln -s $(pwd)/pkg/kubernetes ~/.local/share/cockpit

You should find a 'Kubernetes Master' item on the 'Tools' menu in Cockpit.

Now put some objects into kubernetes:

    $ cd /path/to/cockpit/pkg/kubernetes/examples
    $ kubectl create -f k8s-sample-app.json

More information on these example objects, and what you can get running
with them here: https://github.com/GoogleCloudPlatform/kubernetes/tree/master/examples/guestbook


Openshift
---------

Openshift is really Kubernetes underneath. To run with Openshift, you currently have
to disable Openshift authorization. Run the following commands to do that. If you're
running openshift in a container then run the first command:

    $ sudo docker exec -it openshift-origin bash
    # osadm policy add-role-to-user cluster-admin system:anonymous
    # osadm policy add-role-to-user cluster-admin system:anonymous --namespace=master
    # osadm policy add-cluster-role-to-user cluster-admin system:anonymous

Different versions of Openshift require different commands, hence the scattersho
running all three.
