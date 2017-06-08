This is a redis sample application, in which redis master and slave components are packaged as an atomic application based on the nulecule specification. 

Kubernetes is currently the only supported provider. You'll need to run this from a workstation that has the atomic CLI and kubectl client that can connect to a kubernetes master. This example depends on kube-dns being configured on your kubernetes cluster.

### Step 1

Build this app:

```
atomicapp build $USER/redis-centos7-atomicapp
```

### Step 2 

Run this app:

```
atomic run $USER/redis-centos7-atomicapp
```


