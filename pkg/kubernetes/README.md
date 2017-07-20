Developing the kubernetes component
-----------------------------------

This component adds functionality to Cockpit to perform admin tasks on
Kubernetes or Openshift. You'll see a "Cluster" tab listed in Cockpit.

### Running a test instance

There's a test instance of Openshift (and also Kubernetes) that's you
can run using the following command:

    $ test/vm-run openshift

To then access that it run the following in another terminal:

    $ sudo yum install kubernetes-client
    $ mkdir -p ~/.kube
    $ cp bots/images/files/openshift.kubeconfig ~/.kube/config

You should now be able to use the kubectl command to access the cluster:

    $ kubectl get pods
