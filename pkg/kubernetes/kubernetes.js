/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

define([
    "jquery",
    "latest/cockpit",
    "latest/po"
], function($, cockpit, po) {
    "use strict";

    cockpit.locale(po);
    var _ = cockpit.gettext;

    var kubernetes = { };

    function debug() {
        if (window.debugging == "all" || window.debugging == "kubernetes")
            console.debug.apply(console, arguments);
    }

    function EtcdMonitor() {
        var self = this;

        var etcd = cockpit.http(4001);
        var request;
        var timeout;

        function notify(index) {
            var params = { wait: true, recursive: true };
            if (index !== undefined)
                params["waitIndex"] = index;
            request = etcd.get("/v2/keys/", params)
                .done(function(data) {
                    var resp = { };
                    $(self).triggerHandler("changed");
                    if (data) {
                        try {
                            resp = JSON.parse(data);
                        } catch(ex) {
                            console.warn("etcd parse exception", ex, data);
                        }
                    }
                    var nindex;
                    if (resp.node && resp.node.modifiedIndex)
                        nindex = resp.node.modifiedIndex;
                    else if (resp.prevNode && resp.prevNode.modifiedIndex)
                        nindex = resp.prevNode.modifiedIndex;
                    if (nindex !== undefined) {
                        nindex++;
                        notify(nindex);
                    } else {
                        timeout = window.setTimeout(function() { notify(); }, 2000);
                    }
                })
                .fail(function(ex) {
                    request = null;
                    console.warn("etcd: " + ex.message);
                });
        }

        self.poke = function poke() {
            if (!request)
                notify();
        };

        self.close = function close() {
            if (request)
                request.close();
        };

        notify();
    }

    function KubernetesClient() {
        var self = this;

        var api = cockpit.http(8080);
        var first = true;

        self.nodes = [ ];
        self.pods = [ ];
        self.services = [ ];
        self.replicationcontrollers = [];

        var later;
        var monitor = new EtcdMonitor();
        $(monitor).on("changed", function() {
            if (!later) {
                later = window.setTimeout(function() {
                    later = null;
                    update();
                }, 200);
            }
        });

        function receive(data, what) {
            var resp = JSON.parse(data);
            if (!resp.items)
                return;
            resp.items.sort(function(a1, a2) {
                return (a1.id || "").localeCompare(a2.id || "");
            });
            self[what] = resp.items;

            if (!first)
                $(self).triggerHandler(what, [ self[what] ]);
        }

        function failure(ex) {
            console.warn(ex);
        }

        this.delete_pod = function delete_pod(pod_name) {
            api.request({"method": "DELETE",
                "body": "",
                "path": "/api/v1beta3/namespaces/default/pods/" + encodeURIComponent(pod_name)
            }).fail(failure);
        };

        this.delete_node = function delete_node(nodes_name) {
            api.request({"method": "DELETE",
                "body": "",
                "path": "/api/v1beta3/namespaces/default/nodes/" + encodeURIComponent(nodes_name)
            }).fail(failure);
        };

        this.delete_replicationcontroller = function delete_replicationcontroller(rc_name) {
            api.request({"method": "DELETE",
                "body": "",
                "path": "/api/v1beta3/namespaces/default/replicationcontrollers/" + encodeURIComponent(rc_name)
            }).fail(failure);
        };

        this.delete_service = function delete_service(service_name) {
            api.request({"method": "DELETE",
                "body": "",
                "path": "/api/v1beta3/namespaces/default/services/" + encodeURIComponent(service_name)
            }).fail(failure);
        };

        this.create_replicationcontroller = function create_replicationcontroller(replicationcontroller_json) {
            api.post("/api/v1beta3/namespaces/default/replicationcontrollers", replicationcontroller_json)
               .fail(failure);
        };

        this.create_node = function create_node(node_json) {
            api.post("/api/v1beta3/namespaces/default/nodes", node_json)
               .fail(failure);
        };

        this.create_pod = function create_pod(pod_json) {
            api.post("/api/v1beta3/namespaces/default/pods", pod_json)
               .fail(failure);
        };

        this.create_service = function create_pod(service_json) {
            api.post("/api/v1beta3/namespaces/default/services", service_json)
               .fail(failure);
        };

        this.update_replicationcontroller = function update_replicationcontroller(rc_json, rc_name) {
            api.request({"method": "PUT",
                "body": rc_json,
                "path": "/api/v1beta3/namespaces/default/replicationcontrollers/" + encodeURIComponent(rc_name)
            }).fail(failure);
        };

        this.get_entities_exists = function get_entities_exists(lname) {
            var gservices = $.grep(self.services, function(element) {
                if (element) { //skip kubernetes services
                    if (element.spec.selector) {
                        if (element.spec.selector.hasOwnProperty(lname)) {
                            return true;
                        }
                    }
                }
            });
            var gpods = $.grep(self.pods, function(element) {
                if (element) {
                    if (element.metadata.labels) {
                        if (element.metadata.labels.hasOwnProperty(lname)) {
                            return true;
                        }
                    }
                }
            });
            return {
                "services": gservices,
                "pods": gpods
            };
        };

        this.get_entities_in = function get_entities_in(lname, lvalues) {
            var gservices = $.grep(self.services, function(element) {
                if (element) { //skip kubernetes services
                    if (element.spec.selector) {
                        if (element.spec.selector.hasOwnProperty(lname)) {
                            if ($.inArray($.trim(element.spec.selector[lname]), lvalues)) {
                                return true;
                            }
                        }
                    }
                }
            });
            var gpods = $.grep(self.pods, function(element) {
                if (element) {
                    if (element.metadata.labels) {
                        if (element.metadata.labels.hasOwnProperty(lname)) {
                            if ($.inArray($.trim(element.metadata.labels[lname]), lvalues)) {
                                return true;
                            }
                        }
                    }
                }
            });
            return {
                "services": gservices,
                "pods": gpods
            };
        };

        this.get_entities_notin = function get_entities_notin(lname, lvalues) {
            var gservices = $.grep(self.services, function(element) {
                if (element) {
                    if (element.spec.selector) {
                        if (element.spec.selector.hasOwnProperty(lname)) {
                            if ($.inArray($.trim(element.spec.selector[lname]), lvalues) == -1) {
                                return true;
                            }
                        }
                    }
                }
            });
            var gpods = $.grep(self.pods, function(element) {
                if (element) {
                    if (element.metadata.labels) {
                        if (element.metadata.labels.hasOwnProperty(lname)) {
                            if ($.inArray($.trim(element.metadata.labels[lname]), lvalues) == -1) {
                                return true;
                            }
                        }
                    }
                }
            });
            return {
                "services": gservices,
                "pods": gpods
            };
        };

        function update() {
            var reqs = [];

            reqs.push(api.get("/api/v1beta3/nodes")
                .fail(failure)
                .done(function(data) {
                    receive(data, "nodes");
                }));

            reqs.push(api.get("/api/v1beta3/pods")
                .fail(failure)
                .done(function(data) {
                    receive(data, "pods");
                }));

            reqs.push(api.get("/api/v1beta3/services")
                .fail(failure)
                .done(function(data) {
                    receive(data, "services");
                }));

            reqs.push(api.get("/api/v1beta3/replicationcontrollers")
                .fail(failure)
                .done(function(data) {
                    receive(data, "replicationcontrollers");
                }));

            if (first) {
                $.when.apply($, reqs)
                    .always(function() {
                        first = false;
                        $(self).triggerHandler("nodes", [ self.nodes ]);
                        $(self).triggerHandler("services", [ self.services ]);
                        $(self).triggerHandler("pods", [ self.pods ]);
                        $(self).triggerHandler("replicationcontrollers", [ self.replicationcontrollers ]);
                    });
            }
        }

        update();

        self.close = function close() {
            monitor.close();
        };
    }

    function EtcdClient() {
        var self = this;

        var etcd_api = cockpit.http(7001);
        var first = true;
        var later;

        function receive(data, what ,kind) {
            var resp = JSON.parse(data);
            self[what] = resp;

            if (!first)
                $(self).triggerHandler(what, [ self[what] ]);
        }

        function failure(ex) {
            console.warn(ex);
        }

        function update() {
            var reqs = [];

            reqs.push(etcd_api.get("/v2/admin/machines")
                .fail(failure)
                .done(function(data) {
                    receive(data, "etcdHosts");
                }));

            reqs.push(etcd_api.get("/v2/keys/coreos.com/network/config")
                .fail(failure)
                .done(function(data) {
                    receive(data, "flannelConfig");
                }));

            if (first) {
                $.when.apply($, reqs)
                    .always(function() {
                        first = false;
                        $(self).triggerHandler("etcdHosts", [ self.etcdHosts ]);
                    });
            }
        }

        update();
    }

    kubernetes.k8client = function client() {
        return new KubernetesClient();
    };

    kubernetes.etcdclient = function client() {
        return new EtcdClient();
    };

    return kubernetes;
});
