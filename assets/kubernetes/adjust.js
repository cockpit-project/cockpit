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

define([
    "jquery",
    "base1/cockpit",
    "base1/mustache",
    "kubernetes/client",
    "base1/patterns"
], function(jQuery, cockpit, Mustache, kubernetes) {
    "use strict";

    var _ = cockpit.gettext;
    var $ = jQuery.scoped("#adjust-dialog");

    var kube = null;

    var dialog = $("#adjust-dialog", document);

    dialog
        .on("show.bs.modal", function(ev) {
            kube = kubernetes.k8client();

            var uid = $(ev.relatedTarget).attr("data-id");
            var service = kube.objects[uid];

            if (!service) {
                console.warn("no such service:", uid);
                return;
            }

            var meta = service.metadata || { };
            var spec = service.spec || { };

            /* We can't edit the name for now */
            $("#adjust-name")
                .val(meta.name)
                .attr("disabled", "disabled");

            /* Generate table rows for each replication controller this service matches */
            var rcs = kube.select("ReplicationController", meta.namespace,
                                  spec.selector || { }, true);

            var replicas = rcs.items.map(function(item) {
                var meta = item.metadata || { };
                var spec = item.spec || { };
                return {
                    uid: meta.uid,
                    name: meta.name,
                    count: spec.replicas,
                    link: meta.selfLink,
                };
            });

            var template = $("#adjust-template").html();
            $("table.cockpit-form-table").append(Mustache.render(template, { replicas: replicas }));

            /* Only show header if any replicas */
            $(".adjust-replicas-header").toggle(replicas.length > 0);
        })
        .on("hide.bs.modal", function(ev) {
            $("tr.adjust-replicas").remove();
            kube.close();
            kube = null;
        });

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

    function gather() {
        var failures = [];
        var tasks = [];

        $("input.adjust-replica").each(function() {
            var input = $(this);

            var uid, ex, value;
            uid = input.attr("id");
            value = Number($.trim(input.val()));
            if (isNaN(value) || value < 0)
                ex = new Error(_("Not a valid number of replicas"));
            else if (value > 128)
                ex = new Error(_("The maximum number of replicas is 128"));

            if (ex) {
                ex.target = "#" + uid;
                failures.push(ex);
            }

            var link = input.attr("data-link");
            var task = function() {
                return kube.modify(link, function(item) {
                    return resize(item, value);
                });
            };

            task.label = cockpit.format(_("Updating $0..."), input.attr("data-name"));
            tasks.push(task);
        });

        if (failures.length) {
            dialog.dialog("failure", failures);
            return null;
        }

        return tasks;
    }

    function perform(tasks) {
        var dfd = $.Deferred();
        var req;

        function step() {
            var task = tasks.shift();
            if (!task) {
                dfd.resolve();
                return;
            }

            dfd.notify(task.label || null);

            req = task()
                .done(function() {
                    step();
                })
                .fail(function(ex) {
                    dfd.reject(ex);
                });
        }

        step();

        var promise = dfd.promise();
        promise.cancel = function cancel() {
            if (req && req.cancel)
                req.cancel();
        };

        return promise;
    }

    $(".btn-primary").on("click", function() {
        var tasks = gather();
        if (!tasks)
            return;

        var promise = perform(tasks);
        dialog.dialog("promise", promise);
    });
});

