This is the [guestbook-go](https://github.com/GoogleCloudPlatform/kubernetes/tree/master/examples/guestbook-go) sample application from the kubernetes project, packaged as an atomic application based on the nulecule specification. 

Kubernetes is currently the only supported provider. You'll need to run this from a workstation that has the atomic CLI and kubectl client that can connect to a kubernetes master. This example depends on kube-dns being configured on your kubernetes cluster.

### Step 1

Build this app:

```
atomicapp build $USER/guestbookgo-app
```

### Step 2 

Run this app:

```
atomic run $USER/guestbookgo-app
```

You'll be prompted to replace the value `publicip` with an IP address or addresses at which your app can be reached. On a single machine kubernetes cluster, for instance, you would provide the IP address of your single kubelet.

### Step 3

Access the guestbook. After the images are pulled (may take a few minutes), you should be able to access the guestbook-go app at port 3000 of the IP address you provided.

