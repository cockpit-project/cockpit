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

/* This is here to support cockpit.jump
 * If this ever needs to be used outsite of cockpit
 * then we'll need abstract this away in kube-client-cockpit
 */
/* globals cockpit */

(function() {
    "use strict";

    var angular = require('angular');
    var d3 = require('d3');
    require('angular-route');

    require('./charts');
    require('./date');
    require('./dialog');
    require('./kube-client');
    require('./listing');
    require('./utils');

    require('../views/nodes-page.html');
    require('../views/node-page.html');
    require('../views/node-body.html');
    require('../views/node-capacity.html');
    require('../views/node-stats.html');
    require('../views/node-add.html');
    require('../views/node-delete.html');
    require('../views/node-alerts.html');

    angular.module('kubernetes.nodes', [
        'ngRoute',
        'kubeClient',
        'kubernetes.date',
        'kubernetes.listing',
        'kubeUtils',
        'ui.cockpit',
        'ui.charts',
    ])

    .config([
        '$routeProvider',
        function($routeProvider) {
            $routeProvider
                .when('/nodes', {
                    templateUrl: 'views/nodes-page.html',
                    controller: 'NodeCtrl'
                })

                .when('/nodes/:target', {
                    controller: 'NodeCtrl',
                    templateUrl: 'views/node-page.html'
                });
        }
    ])

    /*
     * The controller for the node view.
     */
    .controller('NodeCtrl', [
        '$scope',
        'kubeLoader',
        'kubeSelect',
        'ListingState',
        'filterService',
        '$routeParams',
        '$location',
        'nodeActions',
        'nodeData',
        'nodeStatsSummary',
        '$timeout',
        'KubeBrowserStorage',
        function($scope, loader, select,  ListingState, filterService,
                 $routeParams, $location, actions, nodeData, statsSummary,
                 $timeout, browser) {
            var target = $routeParams["target"] || "";
            $scope.target = target;

            $scope.stats = statsSummary.newNodeStatsSummary();

            loader.listen(function() {
                var selection;
                $scope.nodes = select().kind("Node");
                if (target) {
                    selection = select().kind("Node").name(target);
                    $scope.item = selection.one();
                } else {
                    selection = $scope.nodes;
                }
                if ($scope.stats)
                    $scope.stats.trackNodes(selection);
            }, $scope);

            loader.watch("Node", $scope);

            $scope.$on("$destroy", function() {
                if ($scope.stats)
                    $scope.stats.close();
                $scope.stats = null;
            });

            $scope.listing = new ListingState($scope);

            /* All the actions available on the $scope */
            angular.extend($scope, actions);
            angular.extend($scope, nodeData);

            $scope.$on("activate", function(ev, id) {
                $location.path('/nodes/' + encodeURIComponent(id));
                $scope.$applyAsync();
            });

            $scope.nodePods = function node_pods(item) {
                var meta = item.metadata || {};
                return select().kind("Pod").host(meta.name);
            };

            $scope.deleteSelectedNodes = function() {
                var k, selected = [];
                for (k in $scope.listing.selected) {
                    if ($scope.nodes[k] && $scope.listing.selected[k])
                        selected.push($scope.nodes[k]);
                }

                if (!selected.length)
                    return;

                return actions.deleteNodes(selected).then(function() {
                    $scope.listing.selected = {};
                });
            };

            /* Redirect after a delete */
            $scope.deleteNode = function(val) {
                var promise = actions.deleteNodes(val);

                /* If the promise is successful, redirect to another page */
                promise.then(function() {
                    if ($scope.target)
                        $location.path("/nodes");
                });

                return promise;
            };

            $scope.jump = function (node) {
                var host, ip;
                if (!node || !node.spec)
                    return;

                host = node.spec.externalID;
                ip = nodeData.nodeExternalIP(node);

                if (ip == "127.0.0.1" || ip == "::1") {
                    ip = "localhost";
                } else {
                    browser.sessionStorage.setItem(
                        "v1-session-machine/" + ip,
                        JSON.stringify({"address": ip,
                                        "label": host,
                                        visible: true })
                    );
                }

                cockpit.jump("/", ip);
            };
        }
    ])

    .directive('nodeBody',
        function() {
            return {
                restrict: 'A',
                templateUrl: 'views/node-body.html',
            };
        }
    )

    .directive('nodeCapacity',
        function() {
            return {
                restrict: 'A',
                templateUrl: 'views/node-capacity.html',
            };
        }
    )

    .directive('nodeStats',
        function() {
            return {
                restrict: 'A',
                templateUrl: 'views/node-stats.html',
            };
        }
    )

    .factory('nodeActions', [
        '$modal',
        function($modal) {
            function addNode() {
                return $modal.open({
                    animation: false,
                    controller: 'AddNodeCtrl',
                    templateUrl: 'views/node-add.html',
                    resolve: {},
                }).result;
            }

            function deleteNodes(val) {
                var nodes;
                if (angular.isArray(val))
                    nodes = val;
                else
                    nodes = [ val ];

                return $modal.open({
                    animation: false,
                    controller: 'NodeDeleteCtrl',
                    templateUrl: 'views/node-delete.html',
                    resolve: {
                        dialogData: function() {
                            return { nodes: nodes };
                        }
                    },
                }).result;
            }

            return {
                addNode: addNode,
                deleteNodes: deleteNodes
            };
        }
    ])

    .controller("NodeDeleteCtrl", [
        "$q",
        "$scope",
        "$modalInstance",
        "dialogData",
        "kubeMethods",
        "kubeSelect",
        function($q, $scope, $instance, dialogData, methods, select) {

            angular.extend($scope, dialogData);

            $scope.performDelete = function performDelete() {
                var k;
                var errors = [];
                var nodes = {};
                var promises = [];

                function handleError(ex) {
                    errors.push(ex.message || ex.statusText);
                    nodes[k] = $scope.nodes[k];
                    return $q.reject();
                }

                for (k in $scope.nodes) {
                    var p = methods.delete($scope.nodes[k])
                        .catch(handleError);
                    promises.push(p);
                }

                return $q.all(promises).catch(function () {
                    $scope.nodes = select(nodes);
                    return $q.reject(errors);
                });
            };
        }
    ])

    .factory('nodeData', [
        "KubeMapNamedArray",
        "KubeTranslate",
        function (mapNamedArray, translate) {
            var _ = translate.gettext;

            function nodeConditions(node) {
                var status;
                if (!node)
                    return;

                if (!node.conditions) {
                    status = node.status || { };
                    node.conditions = mapNamedArray(status.conditions, "type");
                }
                return node.conditions;
            }

            function nodeCondition(node, type) {
                var conditions = nodeConditions(node) || {};
                return conditions[type] || {};
            }

            function nodeStatus(node) {
                var spec = node ? node.spec : {};
                if (!nodeCondition(node, "Ready").status)
                    return _("Unknown");

                if (nodeCondition(node, "Ready").status != 'True')
                    return _("Not Ready");

                if (spec && spec.unschedulable)
                    return _("Scheduling Disabled");

                return _("Ready");
            }

            function nodeStatusIcon(node) {
                var state = "";
                /* If no status.conditions then it hasn't even started */
                if (!nodeCondition(node, "Ready").status) {
                    state = "wait";
                } else {
                    if (nodeCondition(node, "Ready").status != 'True') {
                        state = "fail";
                    } else if (nodeCondition(node, "OutOfDisk").status == "True" ||
                             nodeCondition(node, "OutOfMemory").status == "True") {
                        state = "warn";
                    }
                }
                return state;
            }

            function nodeExternalIP(node) {
                if (!node || !node.status)
                    return;

                var addresses = node.status.addresses;
                var address;
                /* If no addresses then it hasn't even started */
                if (addresses) {
                    addresses.forEach(function(a) {
                        if (a.type == "LegacyHostIP" || address.type == "ExternalIP") {
                            address = a.address;
                            return false;
                        }
                    });
                }
                return address;
            }

            return {
                nodeStatusIcon: nodeStatusIcon,
                nodeCondition: nodeCondition,
                nodeConditions: nodeConditions,
                nodeStatus: nodeStatus,
                nodeExternalIP: nodeExternalIP
            };
        }
    ])

    .controller("AddNodeCtrl", [
        "$q",
        "$scope",
        "$modalInstance",
        "kubeMethods",
        "KubeTranslate",
        function($q, $scope, $instance, methods, translate) {
            var _ = translate.gettext;
            var fields = {
                "address" : "",
                "name" : "",
            };
            var dirty = false;

            $scope.fields = fields;

            function validate() {
                var regex = /^[a-z0-9.-]+$/i;
                var defer = $q.defer();
                var address = fields.address.trim();
                var name = fields.name.trim();
                var ex;
                var failures = [];
                var item;

                if (!address)
                    ex = new Error(_("Please type an address"));
                else if (!regex.test(address))
                    ex = new Error(_("The address contains invalid characters"));

                if (ex) {
                    ex.target = "#node-address";
                    failures.push(ex);
                }

                if (name && !regex.test(name)) {
                    ex = new Error(_("The name contains invalid characters"));
                    ex.target = "#node-name";
                    failures.push(ex);
                }

                if (failures.length > 0) {
                    defer.reject(failures);
                } else {
                    item = {
                        "kind": "Node",
                        "apiVersion": "v1",
                        "metadata": {
                            "name": name ? name : address,
                        },
                        "spec": {
                            "externalID": address
                        }
                    };
                    defer.resolve(item);
                }

                return defer.promise;
            }

            $scope.nameKeyUp = function nameKeyUp(event) {
                dirty = true;
                if (event.keyCode == 13)
                    $scope.performAdd();
            };

            $scope.addressKeyUp = function addressKeyUp(event) {
                if (event.keyCode == 13)
                    $scope.performAdd();
                else if (!dirty)
                    fields.name = event.target.value;
            };

            $scope.performAdd = function performAdd() {
                return validate().then(function(item) {
                    return methods.create(item);
                });
            };
        }
    ])

    .directive('kubernetesStatusIcon', function() {
        return {
            restrict: 'A',
            link: function($scope, element, attributes) {
                $scope.$watch(attributes["status"], function(status) {
                    element
                        .toggleClass("spinner spinner-xs", status == "wait")
                        .toggleClass("pficon pficon-error-circle-o", status == "fail")
                        .toggleClass("pficon pficon-warning-triangle-o", status == "warn");
                });
            }
        };
    })

    .directive('nodeAlerts', function() {
        return {
            restrict: 'A',
            templateUrl: 'views/node-alerts.html'
        };
    })

    .factory('nodeStatsSummary', [
        "$q",
        "$interval",
        "$exceptionHandler",
        "KubeRequest",
        "nodeData",
        "KubeStringToBytes",
        "KubeFormat",
        function ($q, $interval, $exceptionHandler, KubeRequest, nodeData,
                  kubeStringToBytes, format) {
            function NodeStatsSummary() {
                var self = this;

                var requests = {};
                var statData = {};
                var callbacks = [];
                var interval;

                function request(name) {
                    if (requests[name])
                        return $q.when([]);

                    var path = "/api/v1/nodes/" + encodeURIComponent(name) + "/proxy/stats/summary/";
                    var req = KubeRequest("GET", path);
                    requests[name] = req;

                    return req.then(function(data) {
                            delete requests[name];
                            statData[name] = data.data;
                        })
                        .catch(function(ex) {
                            delete requests[name];
                            delete statData[name];
                            if (ex.status != 503)
                                console.warn(ex);
                        });
                }

                function invokeCallbacks(/* ... */) {
                    var i, len, func;
                    for (i = 0, len = callbacks.length; i < len; i++) {
                        func = callbacks[i];
                        try {
                            if (func)
                                func.apply(self, arguments);
                        } catch (e) {
                            $exceptionHandler(e);
                        }
                    }
                }

                function fetchForNames(names) {
                    var q = [];
                    angular.forEach(names, function(name) {
                        q.push(request(name));
                    });

                    $q.all(q).then(invokeCallbacks, invokeCallbacks);
                }

                interval = $interval(function () {
                    fetchForNames(Object.keys(statData));
                }, 5000);

                self.watch = function watch(callback) {
                    callbacks.push(callback);

                    return {
                        cancel: function() {
                            var i, len;
                            for (i = 0, len = callbacks.length; i < len; i++) {
                                if (callbacks[i] === callback)
                                    callbacks[i] = null;
                            }
                        }
                    };
                };

                self.close = function close() {
                    var name;
                    if (interval)
                        $interval.cancel(interval);

                    for (name in requests) {
                        var req = requests[name];
                        if (req && req.cancel)
                            req.cancel();
                    }
                };

                self.trackNodes = function trackNodes(selection) {
                    var names = [];
                    angular.forEach(selection, function(node) {
                        var ready = nodeData.nodeCondition(node, "Ready");
                        var meta = node ? node.metadata : {};
                        var name = meta ? meta.name : "";

                        if (ready && ready.status === 'True') {
                            if (!statData[name])
                                names.push(name);
                        } else {
                            // Unfortunally i'm seen some requests
                            // not error so clean them out.
                            delete statData[name];
                            if (request[name]) {
                                request[name].cancel();
                                delete request[name];
                            }
                        }
                    });
                    fetchForNames(names);
                };

                self.getSimpleUsage = function getSimpleUsage(node, section) {
                    var meta =  node ? node.metadata : {};
                    var status = node ? node.status : {};
                    var name = meta ? meta.name : "";

                    var nodeData = statData[name] ? statData[name].node : {};
                    var result = nodeData[section];

                    if (!result)
                        return;

                    var allocatable = status ? status.allocatable : {};
                    if (!allocatable)
                        return;

                    switch(section) {
                        case "cpu":
                            if (!allocatable.cpu)
                                return;
                            return {
                                used: result.usageNanoCores,
                                total: allocatable.cpu * 1000000000
                            };
                        case "memory":
                            if (!allocatable.memory)
                                return;
                            return {
                                used: result.usageBytes,
                                total: kubeStringToBytes(allocatable.memory)
                            };
                        case "fs":
                            return {
                                used: result.usedBytes,
                                total: result.capacityBytes
                            };
                        default:
                            return;
                    }
                };
            }

            return {
                newNodeStatsSummary: function(interval) {
                    return new NodeStatsSummary(interval);
                },
            };
        }
    ])

    .directive('nodeOsGraph', [
        "KubeTranslate",
        function(translate) {
            var _ = translate.gettext;

            return {
                scope: {
                    'nodes' : '='
                },
                template: '<div class="col-xs-12 col-md-6" id="os-counts-graph" donut-pct-chart data="data" bar-size="8" legend="os-counts-legend" large-title="largeTitle"></div><div class="col-xs-12 col-md-6 legend-col"><div id="os-counts-legend"></div></div>',
                restrict: 'A',
                link: function($scope, element, attributes) {
                    $scope.data = [];
                    $scope.largeTitle = 0;

                    function refresh(items) {
                        items = items || [];
                        var data = {};
                        angular.forEach(items, function(node) {
                            var os;
                            var color;
                            if (node.status && node.status.nodeInfo)
                                os = node.status.nodeInfo.osImage;

                            if (!os) {
                                os = _("Unknown");
                                color = "#bbbbbb";
                            }

                            if (data[os])
                                data[os].value++;
                            else
                                data[os] = { value: 1, label: os, color: color };
                        });

                        var arr = Object.keys(data).map(function(k) {
                            return data[k];
                        });

                        arr.sort(function (a, b) {
                            if (a.label < b.label)
                                return -1;
                            if (a.label > b.label)
                                return 1;
                            return 0;
                        });

                        $scope.data = arr;
                        $scope.largeTitle = items.length;
                    }

                    $scope.$watchCollection('nodes', function(nodes) {
                        refresh(nodes);
                    });
                }
            };
        }
    ])

    .directive('nodeHeatMap', [
        "KubeTranslate",
        "KubeFormat",
        function(translate, format) {
            var _ = translate.gettext;
            return {
                restrict: 'A',
                scope: {
                    'nodes' : '=',
                    'stats' : '='
                },
                template: '<div class="card-pf-title"><ul class="nav nav-tabs nav-tabs-pf"></ul></div><div threshold-heat-map class="card-pf-body node-heatmap" data="data" clickAction="clickAction()" legend="nodes-heatmap-legend"></div><div id="nodes-heatmap-legend"></div></div>',
                link: function($scope, element, attributes) {
                    var outer = d3.select(element[0]);
                    var currentTab;
                    var tabs = {
                        cpu: {
                            label: _("CPU"),
                            tooltip: function(r) { return format.format(_("CPU Utilization: $0%"), Math.round((r.used / r.total) * 100)); }
                        },
                        memory: {
                            label: _("Memory"),
                            tooltip: function(r) { return format.format(_("Memory Utilization: $0%"), Math.round((r.used / r.total) * 100)); }
                        },
                        fs: {
                            label: _("Disk"),
                            tooltip: function(r) { return format.format(_("Disk Utilization: $0%"), Math.round((r.used / r.total) * 100)); }
                        }
                    };

                    outer.select("ul.nav-tabs")
                        .selectAll("li")
                            .data(Object.keys(tabs))
                          .enter().append("li")
                            .attr("data-metric", function(d) { return d; })
                          .append("a")
                            .text(function(d) { return tabs[d].label; });

                    function changeTab(tab) {
                        currentTab = tab;
                        outer.selectAll("ul.nav-tabs li")
                            .attr("class", function(d) { return tab === d ? "active": null; });
                        refreshData();
                    }

                    outer.selectAll("ul.nav-tabs li")
                        .on("click", function() {
                            changeTab(d3.select(this).attr("data-metric"));
                        });

                    function refreshData() {
                        var nodes = $scope.nodes;
                        var data = [];

                        if (!nodes)
                            nodes = [];

                        angular.forEach(nodes, function(node) {
                            var result, value, name;
                            var tooltip = _("Unknown");
                            if (node && node.metadata)
                                name = node.metadata.name;

                            if (!name)
                                return;

                            result = $scope.stats.getSimpleUsage(node, currentTab);
                            if (result)
                                value = result.used / result.total;

                            if (value === undefined)
                                value = -1;
                            else
                                tooltip = tabs[currentTab].tooltip(result);

                            data.push({ value: value, name: name,
                                        tooltip: tooltip });
                        });

                        data.sort(function (a, b) {
                            return b.value - a.value;
                        });

                        $scope.$applyAsync(function() {
                            $scope.data = data;
                        });
                        return true;
                    }

                    $scope.$on("boxClick", function (ev, name) {
                       $scope.$emit("activate", name);
                    });

                    var sw = $scope.stats.watch(refreshData);
                    $scope.$on("$destroy", function() {
                        sw.cancel();
                    });

                    changeTab("cpu");
                }
            };
        }
    ])

    .directive('nodeUsageDonutChart', [
        "KubeTranslate",
        "KubeFormat",
        function(translate, format) {
            var _ = translate.gettext;
            return {
                restrict: 'A',
                scope: {
                    'node' : '=',
                    'stats' : '=',
                },
                template: '<div ng-if="data" donut-pct-chart data="data" bar-size="8" large-title="largeTitle" small-title="smallTitle"></div><div class="text-center" ng-if="data">{{ title }}</div>',
                link: function($scope, element, attributes) {
                    var colorFunc = d3.scale.threshold()
                        .domain([0.7, 0.8, 0.9])
                        .range(['#d4f0fa', '#F9D67A', '#EC7A08', '#CE0000' ]);

                    var types = {
                        cpu: {
                            label: _("CPU"),
                            smallTitle: function () {},
                            largeTitle: function (result) {
                                var r = result.used / result.total;
                                var p = Math.round(r * 100);
                                return format.format("$0%", p);
                            },
                        },
                        memory: {
                            label: _("Memory"),
                            smallTitle: function (result) {
                                return _("Used");
                            },
                            largeTitle: function (result) {
                                return format.formatBytes(result.used);
                            },
                        },
                        fs: {
                            label: _("Disk"),
                            smallTitle: function (result) {
                                return _("Used");
                            },
                            largeTitle: function (result) {
                                return format.formatBytes(result.used);
                            },
                        }
                    };

                    var type = attributes['type'];
                    $scope.title = types[type].label;

                    function clear() {
                        $scope.$applyAsync(function() {
                            $scope.data = null;
                            $scope.smallTitle = null;
                            $scope.largeTitle = null;
                        });
                    }

                    function refreshData() {
                        var node = $scope.node;
                        var result;

                        if (!node)
                            return clear();

                        result = $scope.stats.getSimpleUsage(node, type);
                        if (result) {
                            $scope.$applyAsync(function() {
                                $scope.smallTitle = types[type].smallTitle(result);
                                $scope.largeTitle = types[type].largeTitle(result);
                                var u = Math.round((result.used / result.total) * 100);
                                var l = 100 - u;
                                var freeText = translate.ngettext("$0% Free",
                                                                  "$0% Free", u);
                                var usedText = translate.ngettext("$0% Used",
                                                                  "$0% Used", u);
                                $scope.data = [
                                    { value: result.total - result.used,
                                      tooltip : format.format(freeText, l),
                                      color: "#bbbbbb"},
                                    { value: result.used,
                                      tooltip : format.format(usedText, u),
                                      color: colorFunc(result.used / result.total) }
                                ];
                            });
                        } else {
                            clear();
                        }
                        return true;
                    }

                    var sw = $scope.stats.watch(refreshData);
                    $scope.$on("$destroy", function() {
                        sw.cancel();
                    });
                }
            };
        }
    ]);

}());
