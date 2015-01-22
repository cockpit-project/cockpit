Kubernetes Proof of Concept
---------------------------

This is proof of concept Kubernetes code. It is not yet installed as part
of Cockpit. To use it follow the instructions below. Tested on Fedora 21
and requires an otherwise working latest version of Cockpit.

This sets up a single machine kubernetes master and minion:

    $ sudo yum install kubernetes
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

    $ cd /path/to/cockpit/pkg/kubernetes
    $ kubectl create pod -f examples/redis-master.json
    $ kubectl create service -f examples/redis-master-service.json
    $ kubectl create service -f examples/redis-slave-service.json
    $ kubectl create replicationController -f examples/redis-slave-controller.json
    $ kubectl create service -f examples/frontend-service.json
    $ kubectl create replicationController -f examples/frontend-controller.json

More information on these example objects, and what you can get running
with them here: https://github.com/GoogleCloudPlatform/kubernetes/tree/master/examples/guestbook
