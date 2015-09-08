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
    "docker/util",
    "base1/bootstrap-select",
], function($, cockpit, Mustache, util) {
    var _ = cockpit.gettext;
    var C_ = cockpit.gettext;

    /* RUN IMAGE DIALOG */

    PageRunImage.prototype = {
        _init: function() {
            this.error_timeout = null;
            this.id = "containers_run_image_dialog";
        },

        setup: function() {
            $("#containers-run-image-run").on('click', $.proxy(this, "run"));
            $('#containers-run-image-command').on('keydown', $.proxy(this, "update", "keydown", "command"));
            $('#containers-run-image-command').on('input', $.proxy(this, "update", "input", "command"));
            $('#containers-run-image-command').on('focusout change', $.proxy(this, "update", "changeFocus", "command"));

            this.memory_slider = new util.MemorySlider($("#containers-run-image-memory"),
                                                       10*1024*1024, 2*1024*1024*1024);
            this.cpu_slider = new util.CpuSlider($("#containers-run-image-cpu"), 2, 1000000);

            var table = $('#containers_run_image_dialog .modal-body table');

            var port_renderer = this.port_renderer();
            var self = this;
            $('#expose-ports').on('change', function() {
                var items = $('#select-exposed-ports');
                if ($(this).prop('checked')) {
                    if (items.children().length === 0) {
                        port_renderer();
                    }
                    items.show();
                }
                else {
                    items.hide();
                }
                self.update('changeFocus', 'ports');
            });

            var renderer = this.link_renderer();
            $("#link-containers").change(function() {
                var items = $('#select-linked-containers');
                if ($(this).prop('checked')) {
                    if (items.children().length === 0 ) {
                        renderer();
                    }
                    items.show();
                } else {
                    items.hide();
                }
                self.update('changeFocus', 'links');
            });

            this.validator = this.configuration_validator();
        },

        update: function(behavior, section) {
            if ((this.perform_checks !== true) && (behavior !== 'clear'))
                return;
            this.validator(behavior, section);
        },

        enter: function() {
            var page = this;

            var info = PageRunImage.image_info;
            util.docker_debug("run-image", info);

            var checked;
            var value;

            PageRunImage.client.machine_info().
                done(function (info) {
                    page.memory_slider.max = info.memory;
                });

            page.containers = [];
            var id;
            for (id in PageRunImage.client.containers) {
                page.containers.push(
                    util.render_container_name(
                        PageRunImage.client.containers[id].Name
                    )
                );
            }

            this.perform_checks = false;

            /* make sure errors are cleared */
            this.update('clear');

            $('#select-linked-containers').empty();
            $("#link-containers").prop("checked", false);

            /* Memory slider defaults */
            if (info.ContainerConfig.Memory) {
                this.memory_slider.value = info.ContainerConfig.Memory;
            } else {
                /* First call sets the position of slider */
                this.memory_slider.value = 512*1024*1024;
                this.memory_slider.value = undefined;
            }

            /* CPU slider defaults */
            if (info.ContainerConfig.CpuShares) {
                this.cpu_slider.value = info.ContainerConfig.CpuShares;
            } else {
                this.cpu_slider.value = 1024;
                this.cpu_slider.value = undefined;
            }

            // from https://github.com/dotcloud/docker/blob/master/pkg/namesgenerator/names-generator.go

            var left = [ "happy", "jolly", "dreamy", "sad", "angry", "pensive", "focused", "sleepy", "grave", "distracted", "determined", "stoic", "stupefied", "sharp", "agitated", "cocky", "tender", "goofy", "furious", "desperate", "hopeful", "compassionate", "silly", "lonely", "condescending", "naughty", "kickass", "drunk", "boring", "nostalgic", "ecstatic", "insane", "cranky", "mad", "jovial", "sick", "hungry", "thirsty", "elegant", "backstabbing", "clever", "trusting", "loving", "suspicious", "berserk", "high", "romantic", "prickly", "evil" ];

            var right = [ "lovelace", "franklin", "tesla", "einstein", "bohr", "davinci", "pasteur", "nobel", "curie", "darwin", "turing", "ritchie", "torvalds", "pike", "thompson", "wozniak", "galileo", "euclid", "newton", "fermat", "archimedes", "poincare", "heisenberg", "feynman", "hawking", "fermi", "pare", "mccarthy", "engelbart", "babbage", "albattani", "ptolemy", "bell", "wright", "lumiere", "morse", "mclean", "brown", "bardeen", "brattain", "shockley" ];

            function make_name() {
                function ranchoice(array) {
                    return array[Math.round(Math.random() * (array.length-1))];
                }
                return ranchoice(left) + "_" + ranchoice(right);
            }

            $("#containers-run-image").text(PageRunImage.image_info.RepoTags[0]);
            $("#containers-run-image-name").val(make_name());
            var command_input = $("#containers-run-image-command");
            command_input.val(util.quote_cmdline(PageRunImage.image_info.Config.Cmd));

            /* delete any old port mapping entries */
            var portmapping = $('#select-exposed-ports');
            portmapping.empty();

            /* show ports exposed by container image */
            var port_renderer = this.port_renderer();
            for (var p in PageRunImage.image_info.Config.ExposedPorts)
                port_renderer(parseInt(p), p.slice(-3), false);

            if (portmapping.children().length > 0) {
                $('#expose-ports').prop('checked', true);
                /* make sure the ports are visible */
                portmapping.show();
            } else {
                $('#expose-ports').prop('checked', false);
            }
        },

        configuration_validator: function() {
            var self = this;

            function check_entries_valid() {
                /* disable run button if there are any errors on the page */
                $('#containers-run-image-run').prop('disabled',
                                                    $('#containers_run_image_dialog').find('.has-error').length > 0);
            }

            function help_item_for_control(control, help_index) {
                if (help_index === undefined)
                    return $(control.closest('.form-inline').find('.help-block'));
                else
                    return $(control.closest('.form-inline').find('.help-block')[help_index]);
            }

            function message_prefix(help_index) {
                if (help_index === undefined)
                    return "";
                else if (help_index === 0)
                    return _("Container") + ": ";
                else
                    return _("Host") + ": ";
            }

            function show_port_message(port, message_type, message, help_index) {
                port.parent().addClass(message_type);
                var help_item = help_item_for_control(port, help_index);
                help_item.text(message_prefix(help_index) + message);
                var err_item = help_item.parent();
                err_item.addClass(message_type);
                err_item.show();
            }

            function clear_control_error(control, help_index) {
                control.parent().removeClass('has-error');
                var err_item = help_item_for_control(control, help_index).parent();
                err_item.removeClass('has-error');
                err_item.hide();
            }

            /* check all exposed ports for duplicate port entries, invalid port numbers and empty fields */
            function check_port(ports, protocols, port_index, help_index) {
                var exposed_port = ports[port_index];
                var port_value = exposed_port.val();

                clear_control_error(exposed_port, help_index);

                /* skip if empty */
                if (port_value === "")
                    return;

                /* check for invalid port number */
                if (/\D/.test(port_value) || (port_value < 0) || (port_value > 65535)) {
                    show_port_message(exposed_port, 'has-error', _("Invalid port"), help_index);
                    return;
                }

                /* check for duplicate entries */
                for (var i = 0; i < ports.length; ++i) {
                    if (i === port_index)
                        continue;
                    var second_port = ports[i];
                    if ((port_value === second_port.val()) && (protocols[port_index] === protocols[i])) {
                        show_port_message(exposed_port, 'has-error', _("Duplicate port"), help_index);
                        return;
                    }
                }
            }

            function clear_port_errors() {
                $('#select-exposed-ports').children('form').each(function() {
                    var element = $(this);
                    var input_ports = element.find('input');
                    input_ports = [ $(input_ports[0]),  $(input_ports[1]) ];
                    clear_control_error(input_ports[0], 0);
                    clear_control_error(input_ports[1], 1);
                });
            }


            function check_ports() {
                /* if #expose-ports isn't checked, then don't check for errors - but make sure errors are cleared */
                if (!$('#expose-ports').prop('checked')) {
                    clear_port_errors();
                    check_entries_valid();
                    return;
                }

                var exposed_ports = { 'container': [], 'host': [], 'protocol': [] };
                /* gather all ports */
                $('#select-exposed-ports').children('form').each(function() {
                    var element = $(this);
                    var input_ports = element.find('input');
                    input_ports = [ $(input_ports[0]),  $(input_ports[1]) ];
                    if ((input_ports[0].val() !== "") || (input_ports[1].val() !== "")) {
                        exposed_ports.container.push(input_ports[0]);
                        exposed_ports.host.push(input_ports[1]);
                        exposed_ports.protocol.push(element.find('select').val().toLowerCase());
                    } else {
                        /* if they are empty, make sure they are both cleared of errors */
                        clear_control_error(input_ports[0], 0);
                        clear_control_error(input_ports[1], 1);
                    }
                });

                /* check ports */
                for (var port_index = 0; port_index < exposed_ports.container.length; ++port_index) {
                    check_port(exposed_ports.container, exposed_ports.protocol, port_index, 0);
                    check_port(exposed_ports.host, exposed_ports.protocol, port_index, 1);
                }

                /* update run status */
                check_entries_valid();
            }

            function clear_command_error() {
                $('#containers-run-image-command-note').hide();
                $('#containers-run-image-command').parent().removeClass('has-error');
            }

            function check_command() {
                /* if command is empty, show error */
                if ($('#containers-run-image-command').val() === "") {
                    $('#containers-run-image-command-note').show();
                    $('#containers-run-image-command').parent().addClass('has-error');
                } else {
                    clear_command_error();
                }

                /* update run status */
                check_entries_valid();
            }

            function show_link_message(control, message_type, message, help_index) {
                control.parent().addClass(message_type);
                var help_item = help_item_for_control(control, help_index);
                help_item.text(message);
                var err_item = help_item.parent();
                err_item.addClass(message_type);
                err_item.show();
            }

            function check_alias(aliases, alias_index ) {
                var alias = aliases[alias_index];
                var alias_value = alias.val();

                clear_control_error(alias, 1);

                /* check for empty field */
                if (alias_value === "") {
                    /* still valid if empty */
                    show_link_message(alias, 'has-error', _("No alias specified"), 1);
                    return;
                }

                /* check for duplicate entries */
                for (var i = 0; i < aliases.length; ++i) {
                    if (i === alias_index)
                        continue;
                    var second_alias = aliases[i];
                    if ((alias_value === second_alias.val())) {
                        show_link_message(alias, 'has-error', _("Duplicate alias"), 1);
                        return;
                    }
                }
            }

            function clear_link_errors() {
                $('#select-linked-containers').children('form').each(function() {
                    var element = $(this);
                    var container = element.find('select');
                    var alias = element.find('input[name="alias"]');

                    clear_control_error(container, 0);
                    clear_control_error(alias, 1);
                });
            }

            function check_links() {
                /* if #link-containers isn't checked, then don't check for errors - but make sure errors are cleared */
                if (!$('#link-containers').prop('checked')) {
                    clear_link_errors();
                    check_entries_valid();
                    return;
                }

                var aliases = [];
                var containers = [];
                /* gather all aliases */
                $('#select-linked-containers').children('form').each(function() {
                    var element = $(this);
                    var container = element.find('select');
                    var alias = element.find('input[name="alias"]');

                    if ((alias.val() !== "") || (container.val() !== "")) {
                        if (container.val() === "")
                            show_link_message(container, 'has-error', _("No container specified"), 0);
                        else
                            clear_control_error(container, 0);
                        aliases.push(alias);
                    } else {
                        /* if they are empty, make sure all errors are cleared */
                        clear_control_error(container, 0);
                        clear_control_error(alias, 1);
                    }
                });

                /* check aliases */
                for (var alias_index = 0; alias_index < aliases.length; ++alias_index)
                    check_alias(aliases, alias_index);

                /* update run status */
                check_entries_valid();
            }

            /*
             * validation functionality for the run image dialog
             *
             * error:
             *   - a port is used more than once (same port/protocol exposed on container, same port/protocol used on host)
             *   - a port number is invalid
             *   - an alias for a linked container is used more than once
             *   - a linked container has no alias or an alias is given for no link
             *
             * any errors will result in a disabled 'run' button
             */
            function update(behavior, section) {
                /* while typing, delay check */
                window.clearTimeout(self.error_timeout);
                self.error_timeout = null;

                if (behavior === "clear") {
                    clear_command_error();
                    clear_port_errors();
                    clear_link_errors();

                    /* update run status */
                    check_entries_valid();
                } else if (behavior === "all") {
                    check_command();
                    check_ports();
                    check_links();
                } else if ((behavior === "changeFocus") || (behavior === "changeOption")) {
                    if (section === "command")
                        check_command();
                    else if (section === "ports")
                        check_ports();
                    else if (section === "links")
                        check_links();
                } else if ((behavior === "input") || (behavior === "keydown")) {
                    if (section === "command")
                        self.error_timeout = window.setTimeout(check_command, 2000);
                    else if (section === "ports")
                        self.error_timeout = window.setTimeout(check_ports, 2000);
                    else if (section === "links")
                        self.error_timeout = window.setTimeout(check_links, 2000);
                    self.setTimeout = null;
                }
            }

            return update;
        },

        port_renderer: function() {
            var self = this;
            var template = $("#port-expose-tmpl").html();
            Mustache.parse(template);

            function add_row() {
                render();
            }

            function remove_row(e) {
                var parent = $(e.target).closest("form");
                parent.remove();
                if ($('#select-exposed-ports').children().length === 0 ) {
                    $("#expose-ports").attr("checked", false);
                }
                /* update run button, this may have removed an error */
                self.validator("changeFocus", "ports");
            }

            function render(port_internal, port_protocol, port_internal_editable) {
                if (port_internal === undefined)
                    port_internal = '';
                if (port_protocol === undefined)
                    port_protocol = 'TCP';
                if (port_internal_editable === undefined)
                    port_internal_editable = true;

                var row = $(Mustache.render(template, {
                    host_port_label: _('to host port'),
                    placeholder: _('none')
                }));
                row.children("button.fa-plus").on('click', add_row);
                if (port_internal_editable) {
                    row.children("button.pficon-close").on('click', remove_row);
                } else {
                    row.children("button.pficon-close").attr('disabled', true);
                }

                var row_container_input = row.find('input[name="container"]');
                row_container_input.val(port_internal);
                if (port_internal_editable) {
                    row_container_input.on('keydown', $.proxy(self, "update", "keydown", "ports"));
                    row_container_input.on('input', $.proxy(self, "update", "input", "ports"));
                    row_container_input.on('focusout change', $.proxy(self, "update", "changeFocus", "ports"));
                } else {
                    row_container_input.attr('disabled', true);
                }

                var row_host_input = row.find('input[name="host"]');
                row_host_input.on('keydown', $.proxy(self, "update", "keydown", "ports"));
                row_host_input.on('input', $.proxy(self, "update", "input", "ports"));
                row_host_input.on('focusout change', $.proxy(self, "update", "changeFocus", "ports"));

                var protocol_select = row.find("div select.selectpicker");
                if (port_internal_editable) {
                    protocol_select.on('change', $.proxy(self, "update", "changeOption", "ports"));
                } else {
                    protocol_select.attr('disabled', true);
                }

                protocol_select.selectpicker('refresh');
                if (port_protocol.toUpperCase() === _("UDP"))
                    protocol_select.selectpicker('val', _("UDP"));
                else
                    protocol_select.selectpicker('val', _("TCP"));

                $("#select-exposed-ports").append(row);
            }

            return render;
        },

        link_renderer: function() {
            var self = this;
            var template = $("#container-link-tmpl").html();
            Mustache.parse(template);

            function add_row() {
                render();
            }

            function remove_row(e) {
                var parent = $(e.target).closest("form");
                parent.remove();
                if ($('#select-linked-containers').children().length === 0 ) {
                    $("#link-containers").attr("checked", false);
                }

                /* update run button, this may have removed an error */
                self.update("changeFocus", "links");
            }

            function render() {
                var row = $(Mustache.render(template, {
                    containers: self.containers,
                    alias_label: _('alias'),
                    placeholder: _('none')
                }));
                row.children("button.fa-plus").on('click', add_row);
                row.children("button.pficon-close").on('click', remove_row);
                var row_input = row.find('input');
                row_input.on('keydown', $.proxy(self, "update", "keydown", "links"));
                row_input.on('input', $.proxy(self, "update", "input", "links"));
                row_input.on('focusout change', $.proxy(self, "update", "changeFocus", "links"));
                var container_select = row.find("div select.selectpicker");
                container_select.on('change', $.proxy(self, "update", "changeOption", "links"));
                container_select.selectpicker('refresh');
                $("#select-linked-containers").append(row);
            }

            return render;
        },

        run: function() {
            this.perform_checks = true;
            /* validate input, abort on error */
            this.update('all');
            if ($('#containers-run-image-run').prop('disabled'))
                return;
            var name = $("#containers-run-image-name").val();
            var cmd = $("#containers-run-image-command").val();
            var port_bindings = { };
            var p, mapping;
            var map_from, map_to, map_protocol;
            var links = [];
            var exposed_ports = { };
            if ($('#expose-ports').prop('checked')) {
                $('#select-exposed-ports').children('form').each(function() {
                    var input_ports = $(this).find('input').map(function(idx, elem) {
                        return $(elem).val();
                    }).get();
                    map_from = input_ports[0];
                    map_to = input_ports[1];
                    map_protocol = $(this).find('select').val().toLowerCase();

                    if (map_from === '' || map_to === '')
                        return;

                    port_bindings[map_from + '/' + map_protocol] = [ { "HostPort": map_to } ];
                    exposed_ports[map_from + '/' + map_protocol] = { };
                });
            }

            if ($("#link-containers").prop('checked')) {
                $("#select-linked-containers form").each(function() {
                    var element = $(this);
                    var container = element.find('select[name="container"]').val();
                    var alias = element.find('input[name="alias"]').val();
                    if (!container || !alias) {
                        return;
                    }
                    links.push(container + ':' + alias);
                });
            }

            $("#containers_run_image_dialog").modal('hide');

            var tty = $("#containers-run-image-with-terminal").prop('checked');
            var options = {
                "Cmd": util.unquote_cmdline(cmd),
                "Image": PageRunImage.image_info.Id,
                "Memory": this.memory_slider.value || 0,
                "MemorySwap": (this.memory_slider.value * 2) || 0,
                "CpuShares": this.cpu_slider.value || 0,
                "Tty": tty,
                "ExposedPorts": exposed_ports,
                "HostConfig": {
                    "Links": links
                }
            };

            if (tty) {
                $.extend(options, {
                    "AttachStderr": true,
                    "AttachStdin": true,
                    "AttachStdout": true,
                    "OpenStdin": true,
                    "StdinOnce": true
                });
            }

            PageRunImage.client.create(name, options).
                fail(function(ex) {
                    util.show_unexpected_error(ex);
                }).
                done(function(result) {
                    PageRunImage.client.start(result.Id, { "PortBindings": port_bindings }).
                        fail(function(ex) {
                            util.show_unexpected_error(ex);
                        });
                });
        }
    };

    function PageRunImage() {
        this._init();
    }

    var dialog = new PageRunImage();
    dialog.setup();

    function run(client, id) {
        PageRunImage.image_info = client.images[id];
        PageRunImage.client = client;
        dialog.enter();
        $("#containers_run_image_dialog").modal('show');
    }

    return run;

});
