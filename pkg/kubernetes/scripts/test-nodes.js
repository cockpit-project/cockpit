/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

var angular = require("angular");
var QUnit = require("qunit-tests");

require("./nodes");
require("./kube-client-cockpit");

function suite(fixtures) {
    "use strict";

    /* Filled in with a function */
    var inject;
    var assert = QUnit;

    var module = angular.module("kubernetes.nodes.tests", [
        "kubeClient",
        'kubeClient.cockpit',
        "kubernetes.nodes",
    ])

    .config([
        'KubeTranslateProvider',
        'KubeFormatProvider',
        function(KubeTranslateProvider, KubeFormatProvider) {
            KubeTranslateProvider.KubeTranslateFactory = "CockpitTranslate";
            KubeFormatProvider.KubeFormatFactory = "CockpitFormat";
        }
    ]);

    function nodesTest(name, count, fixtures, func) {
        QUnit.test(name, function() {
            assert.expect(count);
            inject([
                "kubeLoader",
                function(loader, data) {
                    loader.reset(true);
                    if (fixtures)
                        loader.handle(fixtures);
                }
            ]);
            inject(func);
        });
    }

    nodesTest("nodeStatus tests", 10, fixtures, [
        "nodeData",
        "kubeSelect",
        function(nodeData, select) {
            var nodes = select().kind("Node");
            assert.equal(nodeData.nodeStatus(), "Unknown", "undefined node");
            assert.equal(nodeData.nodeStatus({}), "Unknown", "empty node");
            assert.equal(nodeData.nodeStatus(nodes['/api/v1/nodes/unknown-node']), "Unknown", "no conditions");
            assert.equal(nodeData.nodeStatus(nodes['/api/v1/nodes/unknown-node2']), "Unknown", "no ready condition");
            assert.equal(nodeData.nodeStatus(nodes['/api/v1/nodes/failed-node']), "Not Ready", "failed");
            assert.equal(nodeData.nodeStatus(nodes['/api/v1/nodes/ready-node']), "Ready",  "ready");
            assert.equal(nodeData.nodeStatus(nodes['/api/v1/nodes/unschedulable-node']),  "Scheduling Disabled", "ready but unschedulable");
            assert.equal(nodeData.nodeStatus(nodes['/api/v1/nodes/unschedulable-failed-node']), "Not Ready", "not ready and unschedulable");
            assert.equal(nodeData.nodeStatus(nodes['/api/v1/nodes/disk-node']), "Ready", "out of disk");
            assert.equal(nodeData.nodeStatus(nodes['/api/v1/nodes/mem-node']), "Ready", "out of memory");
        }
    ]);

    nodesTest("nodeStatusIcon tests", 10, fixtures, [
        "nodeData",
        "kubeSelect",
        function(nodeData, select) {
            var nodes = select().kind("Node");
            assert.equal(nodeData.nodeStatusIcon(), "wait", "undefined node");
            assert.equal(nodeData.nodeStatusIcon({}), "wait", "empty node");
            assert.equal(nodeData.nodeStatusIcon(nodes['/api/v1/nodes/unknown-node']), "wait", "no conditions");
            assert.equal(nodeData.nodeStatusIcon(nodes['/api/v1/nodes/unknown-node2']), "wait", "no ready condition");
            assert.equal(nodeData.nodeStatusIcon(nodes['/api/v1/nodes/failed-node']), "fail", "failed");
            assert.equal(nodeData.nodeStatusIcon(nodes['/api/v1/nodes/ready-node']),  "");
            assert.equal(nodeData.nodeStatusIcon(nodes['/api/v1/nodes/unschedulable-node']), "", "ready but unschedulable");
            assert.equal(nodeData.nodeStatusIcon(nodes['/api/v1/nodes/unschedulable-failed-node']), "fail", "not ready and unschedulable");
            assert.equal(nodeData.nodeStatusIcon(nodes['/api/v1/nodes/disk-node']), "warn", "out of disk");
            assert.equal(nodeData.nodeStatusIcon(nodes['/api/v1/nodes/mem-node']), "warn", "out of memory");
        }
    ]);

    nodesTest("nodeConditions tests", 5, fixtures, [
        "nodeData",
        "kubeSelect",
        function(nodeData, select) {
            var nodes = select().kind("Node");
            assert.equal(nodeData.nodeConditions(), undefined);
            assert.equal(nodeData.nodeConditions(null), undefined);
            assert.deepEqual(nodeData.nodeConditions({}), {});
            var conditions = nodeData.nodeConditions(nodes['/api/v1/nodes/unschedulable-node']);
            assert.deepEqual(conditions, {
              "OutOfDisk": {
                "status": "False",
                "type": "OutOfDisk"
              },
              "Ready": {
                "status": "True",
                "type": "Ready"
              }
            }, "Correct object");
            assert.strictEqual(conditions, nodeData.nodeConditions(nodes['/api/v1/nodes/unschedulable-node']), "identical when called with the same object");
        }
    ]);

    angular.module('exceptionOverride', []).factory('$exceptionHandler', function() {
        return function(exception, cause) {
            exception.message += ' (caused by "' + cause + '")';
            throw exception;
        };
    });

    module.run([
        '$injector',
        function($injector) {
            inject = function inject(func) {
                return $injector.invoke(func);
            };
            QUnit.start();
        }
    ]);

    angular.bootstrap(document, ['kubernetes.nodes.tests']);
}

/* Invoke the test suite with this data */
suite([
{
    "kind": "Node",
    "apiVersion": "v1",
    "metadata": {
        "name": "unknown-node",
        "selfLink": "/api/v1/nodes/unknown-node",
        "uid": "4920ab25-1092-11e6-a03c-5254009e00f1",
        "resourceVersion": "17152",
    },
    "status": {
    }
},
{
    "kind": "Node",
    "apiVersion": "v1",
    "metadata": {
        "name": "unknown-node2",
        "selfLink": "/api/v1/nodes/unknown-node2",
        "uid": "4920ab25-1092-11e6-a03c-5254009e00f2",
        "resourceVersion": "17152",
    },
    "status": {
        "conditions": [
            {
                "type": "Other",
                "status": "Other",
            },
        ],
    }
},
{
    "kind": "Node",
    "apiVersion": "v1",
    "metadata": {
        "name": "failed-node",
        "selfLink": "/api/v1/nodes/failed-node",
        "uid": "4920ab25-1092-11e6-a03c-5254009e00f3",
        "resourceVersion": "17152",
    },
    "status": {
        "conditions": [
            {
                "type": "Ready",
                "status": "Other",
            },
        ],
    }
},
{
    "kind": "Node",
    "apiVersion": "v1",
    "metadata": {
        "name": "ready-node",
        "selfLink": "/api/v1/nodes/ready-node",
        "uid": "4920ab25-1092-11e6-a03c-5254009e00f4",
        "resourceVersion": "17152",
    },
    "status": {
        "conditions": [
            {
                "type": "Ready",
                "status": "True",
            },
        ],
    }
},
{
    "kind": "Node",
    "apiVersion": "v1",
    "metadata": {
        "name": "unschedulable-node",
        "selfLink": "/api/v1/nodes/unschedulable-node",
        "uid": "4920ab25-1092-11e6-a03c-5254009e00f5",
        "resourceVersion": "17152",
    },
    "spec": {
        "unschedulable": true
    },
    "status": {
        "conditions": [
            {
                "type": "Ready",
                "status": "True",
            },
            {
                "type": "OutOfDisk",
                "status": "False",
            }
        ],
    }
},
{
    "kind": "Node",
    "apiVersion": "v1",
    "metadata": {
        "name": "unschedulable-failed-node",
        "selfLink": "/api/v1/nodes/unschedulable-failed-node",
        "uid": "4920ab25-1092-11e6-a03c-5254009e00f7",
        "resourceVersion": "17152",
    },
    "spec": {
        "unschedulable": true
    },
    "status": {
        "conditions": [
            {
                "type": "Ready",
                "status": "False",
            },
            {
                "type": "OutOfDisk",
                "status": "False",
            }
        ],
    }
},
{
    "kind": "Node",
    "apiVersion": "v1",
    "metadata": {
        "name": "disk-node",
        "selfLink": "/api/v1/nodes/disk-node",
        "uid": "4920ab25-1092-11e6-a03c-5254009e00f8",
        "resourceVersion": "17152",
    },
    "status": {
        "conditions": [
            {
                "type": "Ready",
                "status": "True",
            },
            {
                "type": "OutOfDisk",
                "status": "True",
            }
        ],
    }
},
{
    "kind": "Node",
    "apiVersion": "v1",
    "metadata": {
        "name": "mem-node",
        "selfLink": "/api/v1/nodes/mem-node",
        "uid": "4920ab25-1092-11e6-a03c-5254009e00f7",
        "resourceVersion": "17152",
    },
    "status": {
        "conditions": [
            {
                "type": "Ready",
                "status": "True",
            },
            {
                "type": "OutOfMemory",
                "status": "True",
            }
        ],
    }
}
]);
