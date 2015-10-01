#!/usr/bin/env node

/*
 * This is used to generate data sets like the one in mock-large.js
 * Use it like so:
 *
 *  $ ./frob-mock.js > ./mock-large.js
 */

var last = 99999999;
function uid() {
    last += 1;
    return "11768037-ab8a-11e4-9a7c-" + last;
}

var pod_template = {
    "kind": "Pod",
    "metadata": {
        "labels": {
            "name": "mock-",
            "number": "",
            "tag": "silly"
        }
    }
};

var objects = {};

var pod, i;
for (i = 0; i < 1000; i++) {
    pod = JSON.parse(JSON.stringify(pod_template));
    pod.metadata.name += i;
    pod.metadata.resourceVersion += i;
    pod.metadata.labels.name += i;
    pod.metadata.labels.number += i;
    pod.metadata.labels.type = ["even", "odd"][i % 2];
    pod.metadata.labels.factor3 = ["yes", "no", "no"][i % 3];

    objects["namespaces/default/pods/mock-" + i] = pod;
}

var repl_template = {
    "kind": "ReplicationController",
    "metadata": {
        "labels": {
            "example": "mock"
        }
    },
    "spec": {
        "replicas": 1,
        "selector": { },
    }
};

var repl = JSON.parse(JSON.stringify(repl_template));
repl.metadata.name = "oddcontroller";
repl.spec.selector = { "tag": "silly", "type": "odd" };
objects["namespaces/default/replicationcontrollers/oddcontroller"] = repl;

repl = JSON.parse(JSON.stringify(repl_template));
repl.metadata.name = "3controller";
repl.spec.selector = { "factor3": "yes" };
objects["namespaces/default/replicationcontrollers/3controller"] = repl;

var path, parts;
for (path in objects) {
    parts = path.split("/");
    objects[path].metadata.resourceVersion = 10000;
    objects[path].metadata.uid = uid();
    objects[path].metadata.namespace = parts[1];
    objects[path].metadata.name = parts.reverse()[0];
    objects[path].metadata.labels.name = objects[path].metadata.name;
}

var data = JSON.stringify(objects, null, 4);
process.stdout.write("define(" + data + ");\n");
