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

require("./utils");

function suite() {
    "use strict";

    /* Filled in with a function */
    var inject;
    var assert = QUnit;

    var module = angular.module("kubeUtils.tests", [
        "kubeUtils",
    ]);

    function utilsTest(name, count, func) {
        QUnit.test(name, function() {
            assert.expect(count);
            inject(func);
        });
    }

    utilsTest("map Named Array", 4, [
        "KubeMapNamedArray",
        function lala(mapNamedArray) {
            var target = {
                "one": {
                    "name": "one",
                    "other": "other1",
                    "value": 1
                },
                "two": {
                    "name": "two",
                    "other": "other2",
                    "value": 2
                }
            };
            var target2 = {
                "other1": {
                    "name": "one",
                    "other": "other1",
                    "value": 1
                },
                "other2": {
                    "name": "two",
                    "other": "other2",
                    "value": 2
                }
            };

            var source = [{
                "name": "one",
                "other": "other1",
                "value": 1
            },{
                "name": "two",
                "other": "other2",
                "value": 2
            }];

            assert.deepEqual(mapNamedArray(), {});
            assert.deepEqual(mapNamedArray([]), {});
            assert.deepEqual(mapNamedArray(source), target);
            assert.deepEqual(mapNamedArray(source, "other"), target2);
        }
    ]);

    utilsTest("Kube string to bytes", 20, [
        "KubeStringToBytes",
        function(stringToBytes) {
            assert.deepEqual(stringToBytes(), undefined);
            assert.deepEqual(stringToBytes("bad"), undefined);
            assert.deepEqual(stringToBytes("10"), undefined);
            assert.deepEqual(stringToBytes("aGi"), undefined);
            assert.deepEqual(stringToBytes("Gi"), undefined);
            assert.deepEqual(stringToBytes("Gi10"), undefined);
            assert.deepEqual(stringToBytes("Gil"), undefined);
            assert.deepEqual(stringToBytes("10E"), 10000000000000000000);
            assert.deepEqual(stringToBytes("10P"), 10000000000000000);
            assert.deepEqual(stringToBytes("10T"), 10000000000000);
            assert.deepEqual(stringToBytes("10G"), 10000000000);
            assert.deepEqual(stringToBytes("10M"), 10000000);
            assert.deepEqual(stringToBytes("10K"), 10000);
            assert.deepEqual(stringToBytes("10m"), 0.01);
            assert.deepEqual(stringToBytes("10Ei"), 11529215046068469760);
            assert.deepEqual(stringToBytes("10Pi"), 11258999068426240);
            assert.deepEqual(stringToBytes("10Ti"), 10995116277760);
            assert.deepEqual(stringToBytes("10Gi"), 10737418240);
            assert.deepEqual(stringToBytes("10Mi"), 10485760);
            assert.deepEqual(stringToBytes("10Ki"), 10240);
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

    angular.bootstrap(document, ['kubeUtils.tests']);
}

suite();
