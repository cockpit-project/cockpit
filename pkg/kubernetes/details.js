define([
    "jquery",
    "base1/cockpit",
    "base1/angular",
    "base1/term",
    "kubernetes/client",
    "kubernetes/app"
], function($, cockpit, angular, Terminal, kubernetes) {
    'use strict';

    var _ = cockpit.gettext;

    var k8client =  kubernetes.k8client();
    var adjust_btn = $('#adjust-rc-button');
    var adjust_rc_dlg = $('#adjust-rc-dialog');
    var adjust_route_btn = $('#adjust-route-button');
    var adjust_route_dlg = $('#adjust-route-dialog');
    var delete_entity_btn = $('#delete-entity-button');
    var delete_entity_dlg = $('#delete-entity-dialog');
    var delete_pod_dlg = $('#delete-pod-dialog');
    var delete_pod_btn = $('#delete-pod-button');


    delete_entity_dlg.on('show.bs.modal', function(e) {
        var key = $(e.relatedTarget).attr("data-key");
        var entity = k8client.objects[key];
        delete_entity_dlg.find('.modal-body').text(cockpit.format(_("Delete $0 $1?"), entity.kind, entity.metadata.name));

        e.stopPropagation();

        delete_entity_btn.off('click').on('click', function() {
            var promise = k8client.remove(entity.metadata.selfLink);
            delete_entity_dlg.dialog("promise", promise);
        });
    });

    adjust_route_dlg.on('show.bs.modal', function(e) {
        var key = $(e.relatedTarget).attr("data-key");
        var entity = k8client.objects[key];
        adjust_route_dlg.find('#host-value').val(entity.spec.host);

        e.stopPropagation();

        adjust_route_btn.off('click').on('click', function() {
            adjust_route_dlg.dialog("failure", null);
            function update_value(item, value) {
                var spec = item.spec;
                if (!spec) {
                    console.warn("route without spec");
                    return false;
                }

                if (spec.host === value)
                    return false;

                spec.host = value;
                return true;
            }

            function update_host(route) {
                var failures = [];
                var dfd = $.Deferred();
                var req;
                var ex;

                var input = $('#host-value').val();
                var value = $.trim(input);
                if (value === "")
                    ex = new Error(_("Not a valid value for Host"));

                if (ex) {
                    ex.target = "#host-value";
                    failures.push(ex);
                }

                if (failures.length) {
                    dfd.reject(failures);
                    return dfd.promise();
                }

                dfd.notify(cockpit.format(_("Updating $0..."), route.metadata.name) || null);

                req = k8client.modify(route.metadata.selfLink, function(item) {
                        return update_value(item, input);
                    })
                    .done(function() {
                        dfd.resolve();
                    })
                    .fail(function(ex) {
                        ex = new Error(_("Unable to modify Routes"));
                        ex.target = "#host-value";
                        failures.push(ex);
                        dfd.reject(failures);
                    });
                return dfd.promise();
            }

            adjust_route_dlg.dialog("promise", update_host(entity));
        });

    });

    adjust_rc_dlg.on('show.bs.modal', function(e) {
        var key = $(e.relatedTarget).attr("data-key");
        var entity = k8client.objects[key];
        adjust_rc_dlg.find('#replica-count').val(entity.spec.replicas);

        adjust_btn.off('click').on('click', function() {
            function resize(item, value) {
                var spec = item.spec;
                if (!spec) {
                    console.warn("replicationcontroller without spec");
                    return false;
                }

                /* Already set at same value */
                if (spec.replicas === value)
                    return false;

                spec.replicas = value;
                return true;
            }

            function update_replica(rc) {
                var failures = [];
                var dfd = $.Deferred();
                var req;
                var ex;

                var input = adjust_rc_dlg.find('#replica-count').val();
                var value = Number($.trim(input));
                if (isNaN(value) || value < 0)
                    ex = new Error(_("Not a valid number of replicas"));
                else if (value > 128)
                    ex = new Error(_("The maximum number of replicas is 128"));

                if (ex) {
                    ex.target = "#replica-count";
                    failures.push(ex);
                }

                if (failures.length) {
                    adjust_rc_dlg.dialog("failure", failures);
                    dfd.reject(ex);
                }

                dfd.notify(cockpit.format(_("Updating $0..."), rc.metadata.name) || null);

                req = k8client.modify(rc.metadata.selfLink, function(item) {
                        return resize(item, value);
                    })
                    .done(function() {
                        dfd.resolve();
                    })
                    .fail(function(ex) {
                        dfd.reject(ex);
                    });
                var promise = dfd.promise();
                promise.cancel = function cancel() {
                    if (req && req.cancel)
                        req.cancel();
                };

                return promise;
            }

            var promise = update_replica(entity);
            adjust_rc_dlg.dialog("promise", promise);
        });

    });

    delete_pod_dlg.on('show.bs.modal', function(e) {
        var pod = $(e.relatedTarget).attr('data-link');

        e.stopPropagation();

        delete_pod_btn.off('click').on('click', function() {
            var promise = k8client.remove(pod);
            delete_pod_dlg.dialog("promise", promise);
        });
    });

    function number_with_suffix_to_bytes (byte_string) {
        var valid_suffixes = {
            "E": 1000000000000000000,
            "P": 1000000000000000,
            "T": 1000000000000,
            "G": 1000000000,
            "M": 1000000,
            "K": 1000,
            "m": 0.001,
            "Ei": 1152921504606846976,
            "Pi": 1125899906842624,
            "Ti": 1099511627776,
            "Gi": 1073741824,
            "Mi": 1048576,
            "Ki": 1024,
        };

        for (var key in valid_suffixes) {
            if (byte_string.length > key.length &&
                byte_string.slice(-key.length) === key) {
                var number = Number(byte_string.slice(0, -key.length));
                if (!isNaN(number))
                    return number * valid_suffixes[key];
            }
        }
        return byte_string;
    }

    function format_addresses_with_ports(addresses, ports) {
        var text = addresses.join(", ");

        if (ports && ports.length) {
            text = text + ":" + ports.map(function(p) {
                if (p.protocol === "TCP")
                    return p.port;
                else
                    return p.port + "/" + p.protocol;
            }).join(", ");
        }

        return text;
    }

    return angular.module('kubernetes.details', ['ngRoute'])
        .config(['$routeProvider', function($routeProvider) {
            $routeProvider.when('/list', {
                templateUrl: 'views/details-page.html',
                controller: 'DetailsCtrl'
            });
        }])

        /*
         * The controller for the details view.
         */
        .controller('DetailsCtrl', [
            '$scope',
            'kubernetesClient',
            function($scope, client) {

                client.include("deploymentconfigs");
                client.include("routes");

                var lists = {
                    Pod: null,
                    ReplicationController: null,
                    Service: null,
                    Node: null,
                    Endpoints: null,
                    DeploymentConfig: null,
                    Route: null
                };

                Object.keys(lists).forEach(function(kind) {
                    lists[kind] = client.select(kind);
                    client.track(lists[kind]);
                    $(lists[kind]).on("changed", function() {
                        $scope.$digest();
                    });
                });

                angular.extend($scope, {
                    pods: lists.Pod,
                    services: lists.Service,
                    nodes: lists.Node,
                    replicationcontrollers: lists.ReplicationController,
                    deploymentconfigs: lists.DeploymentConfig,
                    routes: lists.Route
                });

                $scope.$on("$destroy", function() {
                    angular.forEach(lists, function(list) {
                        client.track(list, false);
                    });
                });

                $scope.itemIdentifier = function item_identifier(item) {
                    var meta = item.metadata || { };
                    var id = item.kind.toLowerCase() + "s/";
                    if (meta.namespace)
                        id = id + meta.namespace + "/";
                    return id + meta.name;
                };

                $scope.serviceEndpoint = function service_endpoint(service) {
                    return client.lookup("Endpoints",
                                         service.metadata.name,
                                         service.metadata.namespace);
                };

                $scope.replicationcontrollerPods = function replicationcontroller_pods(item) {
                    return client.select("Pod",
                                         item.metadata.namespace,
                                         item.spec.selector);
                };

                $scope.nodePods = function node_pods(item) {
                    return client.hosting("Pod", item.metadata.name);
                };

                $scope.nodeReadyCondition = function node_read_condition(conditions) {
                    var ret = {};
                    if (conditions) {
                        conditions.forEach(function(condition) {
                            if (condition.type == "Ready") {
                                ret = condition;
                                return false;
                            }
                        });
                    }
                    return ret;
                };
            }
        ])

        .filter('nodeStatus', function() {
            return function(conditions) {
                var ready = false;

                /* If no status.conditions then it hasn't even started */
                if (conditions) {
                    conditions.forEach(function(condition) {
                        if (condition.type == "Ready") {
                            ready = condition.status == "True";
                            return false;
                        }
                    });
                }
                return ready ? _("Ready") : _("Not Ready");
            };
        })

        .filter('nodeExternalIP', function() {
            return function(addresses) {
                var address = null;

                /* If no status.conditions then it hasn't even started */
                if (addresses) {
                    addresses.forEach(function(a) {
                        if (a.type == "LegacyHostIP" || address.type == "ExternalIP") {
                            address = a.address;
                            return false;
                        }
                    });
                }
                return address ? address : _("Unknown");
            };
        })

        .filter('formatCapacityName', function() {
            return function(key) {
                var data;
                if (key == "cpu") {
                    data = "CPUs";
                } else {
                    key = key.replace(/-/g, " ");
                    data = key.charAt(0).toUpperCase() + key.substr(1);
                }
                return data;
            };
        })

        .filter('formatCapacityValue', function() {
            return function(value, key) {
                var data;
                if (key == "memory") {
                    var raw = number_with_suffix_to_bytes(value);
                    value = cockpit.format_bytes(raw);
                }
                return value;
            };
        })

        .directive('kubernetesServiceCluster', function() {
            return {
                restrict: 'E',
                link: function($scope, element, attributes) {
                    $scope.$watchGroup(["item.spec.clusterIP",
                                        "item.spec.ports"], function(values) {
                        var text = format_addresses_with_ports([values[0]],
                                                               values[1]);
                        element.text(text);
                    });
                }
            };
        });
});
