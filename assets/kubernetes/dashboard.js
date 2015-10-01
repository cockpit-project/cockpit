define([
    "jquery",
    "base1/angular",
    "kubernetes/app"
], function($, angular) {
    'use strict';

    var phantom_checkpoint = phantom_checkpoint || function () { };

    /* TODO: Migrate this to angular */
    $("body").on("click", "#services-enable-change", function() {
        $("#service-list").toggleClass("editable");
        $("#services-enable-change").toggleClass("active");
    });

    $("body").on("click", ".editable", function(ev) {
        var target = $(ev.target);
        if (!target.is("button")) {
            $("#service-list").toggleClass("editable");
            $("#services-enable-change").toggleClass("active");
        }
    });

    return angular.module('kubernetes.dashboard', ['ngRoute'])
        .config(['$routeProvider', function($routeProvider) {
            $routeProvider.when('/', {
                templateUrl: 'views/dashboard-page.html',
                controller: 'DashboardCtrl',
                reloadOnSearch: false,
            });
        }])
        .controller('DashboardCtrl', [
                '$scope',
                '$location',
                'kubernetesClient',
                function($scope, $location, client) {

            /* Service Listing */
            $scope.services = client.select("Service");
            client.track($scope.services);
            $($scope.services).on("changed", digest);

            $scope.serviceContainers = function serviceContainers(service) {
                var spec = service.spec || { };

                /* Calculate number of containers */
                var x = 0;
                var y = 0;

                /*
                 * Calculate "x of y" containers, where x is the current
                 * number and y is the expected number. If x==y then only
                 * show x. The calculation is based on the statuses of the
                 * containers within the pod.  Pod states: Pending,
                 * Running, Succeeded, Failed, and Unknown.
                 */
                client.select("Pod", service.metadata.namespace,
                              service.spec.selector || { }).items.forEach(function(pod) {
                    if (!pod.status || !pod.status.phase)
                        return;
                    var spec = pod.spec || { };
                    var n = 1;
                    if (spec.containers)
                        n = spec.containers.length;
                    switch (pod.status.phase) {
                    case "Pending":
                        y += n;
                        break;
                    case "Running":
                        x += n;
                        y += n;
                        break;
                    case "Succeeded": // don't increment either counter
                        break;
                    case "Unknown":
                        y += n;
                        break;
                    case "Failed":
                        /* falls through */
                    default: /* assume failed */
                        y += n;
                        break;
                    }
                });

                if (x != y)
                    return x + " of " + y;
                else
                    return "" + x;
            };

            $scope.serviceStatus = function serviceStatus(service) {
                var spec = service.spec || { };
                var state = "";

                client.select("Pod", service.metadata.namespace,
                              service.spec.selector || { }).items.forEach(function(pod) {
                    if (!pod.status || !pod.status.phase)
                        return;
                    switch (pod.status.phase) {
                    case "Pending":
                        if (!state)
                            state = "wait";
                        break;
                    case "Running":
                        break;
                    case "Succeeded": // don't increment either counter
                        break;
                    case "Unknown":
                        break;
                    case "Failed":
                        /* falls through */
                    default: /* assume failed */
                        state = "fail";
                        break;
                    }
                });

                return state;
            };

            /* Node listing */

            $scope.nodes = client.select("Node");
            client.track($scope.nodes);
            $($scope.nodes).on("changed", digest);

            $scope.nodeContainers = function nodeContainers(node) {
                var count = 0;
                var meta = node.metadata || { };
                client.hosting("Pod", meta.name).items.forEach(function(pod) {
                    var spec = pod.spec || { };
                    var n = 1;
                    if (spec.containers)
                        n = spec.containers.length;
                    count += n;
                });
                return count;
            };

            $scope.nodeStatus = function nodeStatus(node) {
                var status = node.status || { };
                var conditions = status.conditions;
                var state = "";

                /* If no status.conditions then it hasn't even started */
                if (!conditions) {
                    state = "wait";
                } else {
                    conditions.forEach(function(condition) {
                        if (condition.type == "Ready") {
                            if (condition.status != "True")
                                state = "fail";
                        }
                    });
                }
                return state;
            };

            $scope.jumpService = function jumpService(ev, service) {
                var target = $(ev.target);
                if (target.parents().is(".editable"))
                    return;

                var meta = service.metadata;
                var spec = service.spec;
                if (spec.selector && !$.isEmptyObject(spec.selector) && meta.namespace)
                    $location.path("/pods/" + encodeURIComponent(meta.namespace)).search(spec.selector);
            };

            /* Pod listing */

            var pods = client.select("Pod");
            client.track(pods);
            $(pods).on("changed", digest);

            /* Highlighting */

            $scope.highlighted = null;
            $scope.$on("highlight", function(ev, uid) {
                $scope.highlighted = uid;
            });
            $scope.highlight = function highlight(uid) {
                $scope.$broadcast("highlight", uid);
            };

            $scope.servicesState = function services_state() {
                if ($scope.failure)
                    return 'failed';
                var service;
                for (service in $scope.services)
                    break;
                return service ? 'ready' : 'empty';
            };

            /* Track the loading/failure state of the services area */
            $scope.state = 'loading';
            $scope.client.watches.services.wait()
                .fail(function(ex) {
                    $scope.failure = ex;
                })
                .always(digest);

            $([$scope.services]).on("changed", digest);

            var timeout = null;
            function digest() {
                if (timeout === null) {
                    timeout = window.setTimeout(function() {
                        timeout = null;
                        $scope.$digest();
                        phantom_checkpoint();
                    });
                }
            }
        }])

        .directive('kubernetesStatusIcon', function() {
            return {
                restrict: 'A',
                link: function($scope, element, attributes) {
                    $scope.$watch(attributes["status"], function(status) {
                        element
                            .toggleClass("spinner spinner-sm", status == "wait")
                            .toggleClass("fa fa-exclamation-triangle fa-failed", status == "fail");
                    });
                }
            };
        })

        .directive('kubernetesAddress', function() {
            return {
                restrict: 'E',
                link: function($scope, element, attributes) {
                    $scope.$watchGroup(["item.spec.clusterIP", "item.spec.ports"], function(values) {
                        var address = values[0];
                        var ports = values[1];
                        var href = null;
                        var text = null;

                        /* No ports */
                        if (!ports || !ports.length) {
                            text = address;

                        /* One single HTTP or HTTPS port */
                        } else if (ports.length == 1) {
                            text = address + ":" + ports[0].port;
                            if (ports[0].protocol === "TCP") {
                                if (ports[0].port === 80)
                                    href = "http://" + encodeURIComponent(address);
                                else if (ports[0].port === 443)
                                    href = "https://" + encodeURIComponent(address);
                            } else {
                                text += "/" + ports[0].protocol;
                            }
                        } else {
                            text = " " + address + " " + ports.map(function(p) {
                                if (p.protocol === "TCP")
                                    return p.port;
                                else
                                    return p.port + "/" + p.protocol;
                            }).join(" ");
                        }

                        var el;
                        element.empty();
                        if (href) {
                            el = $("<a>")
                                .attr("href", href)
                                .attr("target", "_blank")
                                .on("click", function(ev) { ev.stopPropagation(); });
                            element.append(el);
                        } else {
                            el = element;
                        }
                        el.text(text);
                    });
                }
            };
        });
});
