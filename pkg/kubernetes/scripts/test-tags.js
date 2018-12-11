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

var specData;

function suite() {
    "use strict";

    /* Filled in with a function */
    var inject;

    var module = angular.module("registry.tags.tests", [
        "registry.tags"
    ]);

    QUnit.test("parseSpec", function (assert) {
        var done = assert.async();
        assert.expect(1);

        inject(["imageTagData", function(data) {
            var names = data.parseSpec(specData);
            assert.deepEqual(names, [ "1", "1.23", "1.24.0", "1.24.2", "latest" ], "parsed names correctly");
            done();
        }]);
    });

    QUnit.test("buildSpec with spec", function (assert) {
        var done = assert.async();
        assert.expect(1);

        inject(["imageTagData", function(data) {
            var spec = angular.extend({ }, specData);
            spec = data.buildSpec(["2.5", "latest", "second"], spec, true, 'docker.io/busybox');
            assert.deepEqual(spec, {
                "dockerImageRepository": "busybox",
                "tags": [
                    { "name": "2.5", "importPolicy": { "insecure": true },
                      "from": { "kind": "DockerImage", "name": "docker.io/busybox:2.5" }},
                    { "annotations": null, "from": { "kind": "DockerImage", "name": "docker.io/busybox:latest" },
                      "generation": 2, "importPolicy": { "insecure": true }, "name": "latest" },
                    { "name": "second", "importPolicy": { "insecure": true },
                      "from": { "kind": "DockerImage", "name": "docker.io/busybox:second" }}
                ]
            }, "build spec correctly");
            done();
        }]);
    });

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

specData = {
    "dockerImageRepository": "busybox",
    "tags": [
        {
            "name": "1",
            "annotations": null,
            "from": {
                "kind": "DockerImage",
                "name": "docker.io/busybox:1"
            },
            "generation": 2,
            "importPolicy": {}
        },
        {
            "name": "1.23",
            "annotations": null,
            "from": {
                "kind": "DockerImage",
                "name": "docker.io/busybox:1.23"
            },
            "generation": 2,
            "importPolicy": {}
        },
        {
            "name": "1.24.0",
            "annotations": null,
            "from": {
                "kind": "DockerImage",
                "name": "docker.io/busybox:1.24.0"
            },
            "generation": 2,
            "importPolicy": {}
        },
        {
            "name": "1.24.2",
            "annotations": null,
            "from": {
                "kind": "DockerImage",
                "name": "docker.io/busybox:1.24.2"
            },
            "generation": 2,
            "importPolicy": {}
        },
        {
            "name": "latest",
            "annotations": null,
            "from": {
                "kind": "DockerImage",
                "name": "docker.io/busybox:latest"
            },
            "generation": 2,
            "importPolicy": {
                "insecure": false
            }
        }
    ]
};

suite();
