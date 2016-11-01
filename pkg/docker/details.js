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

(function() {
    "use strict";

    var $ = require("jquery");
    var cockpit = require("cockpit");

    var Mustache = require("mustache");
    require("patterns");

    var docker = require("./docker");
    var util = require("./util");

    require("console.css");

    var _ = cockpit.gettext;
    var C_ = cockpit.gettext;

    /* CONTAINER DETAILS PAGE
     */

    PageContainerDetails.prototype = {
        _init: function(client) {
            this.client = client;
            this.terminal = null;
        },

        getTitle: function() {
            return C_("page-title", "Containers");
        },

        setup: function() {
            var self = this;

            $('#container-details .content-filter a').on("click", function() {
                cockpit.location.go('/');
            });

            $('#container-details-start').on('click', $.proxy(this, "start_container"));
            $('#container-details-stop').on('click', $.proxy(this, "stop_container"));
            $('#container-details-restart').on('click', $.proxy(this, "restart_container"));
            $('#container-details-delete').on('click', $.proxy(this, "delete_container"));

            self.memory_limit = new util.MemorySlider($("#container-resources-dialog .memory-slider"),
                                                      10*1024*1024, 2*1024*1024*1024);
            self.cpu_priority = new util.CpuSlider($("#container-resources-dialog .cpu-slider"),
                                                   2, 1000000);

            self.memory_usage = $('#container-details-memory .bar-row');
            $('#container-resources-dialog').
                on("show.bs.modal", function() {
                    var info = self.client.containers[self.container_id];

                    /* This slider is only visible if docker says this option is available */
                    $("#container-resources-dialog .memory-slider")
                        .toggle(!!self.client.info.MemoryLimit);

                    if (self.client.info.MemTotal)
                       self.memory_limit.max = self.client.info.MemTotal;

                    /* Fill in the resource dialog */
                    $(this).find(".container-name").text(self.name);
                    self.memory_limit.value = info.MemoryLimit || undefined;
                    self.cpu_priority.value = info.CpuPriority || undefined;
                }).
                find(".btn-primary").on("click", function() {
                    var mem, prom = self.client.change_cpu_priority(self.container_id, self.cpu_priority.value);
                    if (self.client.info.MemoryLimit) {
                        mem = self.client.change_memory_limit(self.container_id, self.memory_limit.value);
                        prom = cockpit.all(mem, prom);
                    }
                    $('#container-resources-dialog').dialog('promise', prom);
                });
        },

        enter: function(container_id) {
            var self = this;

            $(this.client).off('.container-details');

            if (this.terminal) {
                this.terminal.close();
                this.terminal = null;
            }
            $("#container-terminal").hide();

            this.container_id = container_id;
            this.name = this.container_id.slice(0,12);

            $(this.client).on('container.container-details', function (event, id, container) {
                if (id == self.container_id)
                    self.update();
            });

            $('#container-details-commit')[0].dataset.containerId = container_id;

            this.update();
        },

        maybe_show_terminal: function(info) {
            if (!this.terminal) {
                this.terminal = docker.console(this.container_id, { tty: info.Config.Tty });
                $("#container-terminal").empty().append(this.terminal);
                this.terminal.connect();
            }
            this.terminal.typeable(info.State.Running);
            $("#container-terminal").show();
        },

        maybe_reconnect_terminal: function() {
            if (this.terminal && !this.terminal.connected) {
                this.terminal.connect();
                this.terminal.typeable(true);
            }
        },

        add_bindings: function(bindings, config) {
            for (var p in config) {
                var h = config[p];
                if (!h)
                    continue;
                for (var i = 0; i < h.length; i++) {
                    var host_ip = h[i].HostIp;
                    if (host_ip === '')
                        host_ip = '0.0.0.0';
                    var desc = cockpit.format(_("${hip}:${hport} -> $cport"),
                                              { hip: host_ip,
                                                hport: h[i].HostPort,
                                                cport: p
                                              });
                    /* make sure we don't push anything we already have */
                    if (bindings.indexOf(desc) === -1)
                        bindings.push(desc);
                }
            }
            return bindings;
        },

        update: function() {
            $('#container-details-names').text("");
            $('#container-details-id').text("");
            $('#container-details-created').text("");
            $('#container-details-image').text("");
            $('#container-details-command').text("");
            $('#container-details-state').text("");
            $('#container-details-restart-policy').text("");
            $('#container-details-ipaddr').text("");
            $('#container-details-ipprefixlen').text("");
            $('#container-details-gateway').text("");
            $('#container-details-macaddr').text("");
            $('#container-details-ports-row').hide();
            $('#container-details-links-row').hide();
            $('#container-details-resource-row').hide();

            var info = this.client.containers[this.container_id];
            util.docker_debug("container-details", this.container_id, info);

            if (!info) {
                $('#container-details-names').text(_("Not found"));
                return;
            }

            var waiting = !!(this.client.waiting[this.container_id]);
            $('#container-details div.spinner').toggle(waiting);
            $('#container-details button').toggle(!waiting);
            $('#container-details-start').prop('disabled', info.State.Running);
            $('#container-details-stop').prop('disabled', !info.State.Running);
            $('#container-details-restart').prop('disabled', !info.State.Running);
            $('#container-details-commit').prop('disabled', !!info.State.Running);
            $('#container-details-memory-row').toggle(!!info.State.Running);
            $('#container-details-cpu-row').toggle(!!info.State.Running);
            $('#container-details-resource-row').toggle(!!info.State.Running);

            this.name = util.render_container_name(info.Name);
            $('#container-details .content-filter h3 span').text(this.name);

            var port_bindings = [ ];
            if (info.NetworkSettings)
                this.add_bindings(port_bindings, info.NetworkSettings.Ports);
            if (info.HostConfig)
                this.add_bindings(port_bindings, info.HostConfig.PortBindings);

            $('#container-details-id').text(info.Id);
            $('#container-details-names').text(util.render_container_name(info.Name));
            $('#container-details-created').text(info.Created);
            $('#container-details-image').text(info.Image);
            $('#container-details-command').text(util.render_container_cmdline(info));
            $('#container-details-state').text(util.render_container_state(info.State));
            $('#container-details-restart-policy').text(util.render_container_restart_policy(info.HostConfig.RestartPolicy));
            $('#container-details-ipaddr').text(info.NetworkSettings.IPAddress);
            $('#container-details-ipprefixlen').text(String(info.NetworkSettings.IPPrefixLen));
            $('#container-details-gateway').text(info.NetworkSettings.Gateway);
            $('#container-details-macaddr').text(info.NetworkSettings.MacAddress);

            $('#container-details-ports-row').toggle(port_bindings.length > 0);
            $('#container-details-ports').html(util.multi_line(port_bindings));

            this.update_links(info);

            util.update_memory_bar(this.memory_usage, info.MemoryUsage, info.MemoryLimit);
            $('#container-details-memory-text').text(util.format_memory_and_limit(info.MemoryUsage, info.MemoryLimit));

            $('#container-details .cpu-usage').text(util.format_cpu_usage(info.CpuUsage));
            $('#container-details .cpu-shares').text(util.format_cpu_shares(info.CpuPriority));

            this.maybe_show_terminal(info);
        },

        update_links: function(info) {
            $('#container-details-links').empty();
            var links = info.HostConfig.Links;
            if (links) {
                $('#container-details-links-row').toggle(true);
                $('#container-details-links').html(
                    links.join('<br/>')
                );
            }
        },

        start_container: function () {
            var self = this;
            var id = this.container_id;
            this.client.start(this.container_id).
                fail(function(ex) {
                    util.handle_scope_start_container(self.client, id, ex.message, function() { self.maybe_reconnect_terminal(); }, null);
                }).
                done(function() {
                    self.maybe_reconnect_terminal();
                });
        },

        stop_container: function () {
            this.client.stop(this.container_id).
                fail(function(ex) {
                    util.show_unexpected_error(ex);
                });
        },

        restart_container: function () {
            var self = this;
            this.client.restart(this.container_id).
                fail(function(ex) {
                    util.show_unexpected_error(ex);
                }).
                done(function() {
                    self.maybe_reconnect_terminal();
                });
        },

        delete_container: function () {
            var self = this;
            var location = cockpit.location;
            util.confirm(cockpit.format(_("Please confirm deletion of $0"), self.name),
                         _("Deleting a container will erase all data in it."),
                         _("Delete")).
                done(function () {
                    util.docker_container_delete(self.client, self.container_id, function() { location.go("/"); }, function () { });
                });
        }

    };

    function PageContainerDetails(client) {
        this._init(client);
    }

    function init_container_details(client) {
        var page = new PageContainerDetails(client);
        page.setup();

        function hide() {
            $('#container-details').hide();
        }

        function show(id) {
            page.enter(id);
            $('#container-details').show();
        }

        return {
            show: show,
            hide: hide
        };
    }

    module.exports = {
        init: init_container_details
    };
}());
