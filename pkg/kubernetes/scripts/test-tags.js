/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

require("./tags");

function suite() {
    "use strict";

    /* Filled in with a function */
    var inject;
    var assert = QUnit;

    var module = angular.module("registry.tags.tests", [
        "registry.tags"
    ]);

    function tagsTest(name, count, func) {
        QUnit.test(name, function() {
	    /* Nothing happening with fixtures yet */
            assert.expect(count);
            inject(func);
        });
    }

    tagsTest("parseSpec", 1, [
        "imageTagData",
        function(data) {
            var names = data.parseSpec(specData);
            assert.deepEqual(names, ["1", "1.23", "1.24.0", "1.24.2", "latest" ], "parsed names correctly");
        }
    ]);

    tagsTest("buildSpec with spec", 1, [
        "imageTagData",
        function(data) {
            var spec = angular.extend({ }, specData);
            spec = data.buildSpec(["2.5", "latest", "second"], spec, true);
            assert.deepEqual(spec, {
                "dockerImageRepository": "busybox",
                "tags": [
                    { "name": "2.5", "importPolicy": { "insecure": true } },
                    { "annotations": null, "from": { "kind": "DockerImage", "name": "busybox:latest" },
                        "generation": 2, "importPolicy": { "insecure": true }, "name": "latest" },
                    { "name": "second", "importPolicy": { "insecure": true } }
                ]
            }, "build spec correctly");
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

    angular.bootstrap(document, ['registry.tags.tests']);
}

var specData = {
    "dockerImageRepository": "busybox",
    "tags": [
        {
            "name": "1",
            "annotations": null,
            "from": {
                "kind": "DockerImage",
                "name": "busybox:1"
            },
            "generation": 2,
            "importPolicy": {}
        },
        {
            "name": "1.23",
            "annotations": null,
            "from": {
                "kind": "DockerImage",
                "name": "busybox:1.23"
            },
            "generation": 2,
            "importPolicy": {}
        },
        {
            "name": "1.24.0",
            "annotations": null,
            "from": {
                "kind": "DockerImage",
                "name": "busybox:1.24.0"
            },
            "generation": 2,
            "importPolicy": {}
        },
        {
            "name": "1.24.2",
            "annotations": null,
            "from": {
                "kind": "DockerImage",
                "name": "busybox:1.24.2"
            },
            "generation": 2,
            "importPolicy": {}
        },
        {
            "name": "latest",
            "annotations": null,
            "from": {
                "kind": "DockerImage",
                "name": "busybox:latest"
            },
            "generation": 2,
            "importPolicy": {
                "insecure": false
            }
        }
    ]
};

suite();
