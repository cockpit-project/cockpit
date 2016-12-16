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

var $ = require("jquery");
$(function() {
    "use strict";

    var cockpit = require("cockpit");

    var Mustache = require("mustache");
    require("patterns");

    var client = require("./client");
    var util = require("./util");

    var _ = cockpit.gettext;

    /* RUN IMAGE DIALOG */

    var memory_slider = new util.MemorySlider($("#containers-run-image-memory"),
                                              10*1024*1024, 2*1024*1024*1024);
    var cpu_slider = new util.CpuSlider($("#containers-run-image-cpu"), 2, 1000000);

    var container_names = [];
    var image = null;

    (function() {
        var prenderer = port_renderer();
        $('#expose-ports').on('change', function() {
            var items = $('#select-exposed-ports');
            if ($(this).prop('checked')) {
                if (items.children().length === 0)
                    prenderer();
                items.show();
            } else {
                items.hide();
            }
        });

        var vrenderer = volume_renderer();
        $('#mount-volumes').on('change', function() {
            var items = $('#select-mounted-volumes');
            if ($(this).prop('checked')) {
                if (items.children().length === 0)
                    vrenderer();
                items.show();
            } else {
                items.hide();
            }
        });

        var erenderer = envvar_renderer();
        $('#claim-envvars').on('change', function() {
            var items = $('#select-claimed-envvars');
            if ($(this).prop('checked')) {
                if (items.children().length === 0)
                    erenderer();
                items.show();
            } else {
                items.hide();
            }
        });

        var lrenderer = link_renderer();
        $("#link-containers").change(function() {
            var items = $('#select-linked-containers');
            if ($(this).prop('checked')) {
                if (items.children().length === 0 )
                    lrenderer();
                items.show();
            } else {
                items.hide();
            }
        });

        var restart_policy_dropdown = $("#restart-policy-dropdown");
        var restart_policy_dropdown_selected = $("#restart-policy-select > button span.pull-left");

        restart_policy_dropdown.find("a").on('click', function () {
            restart_policy_dropdown_selected.text($(this).text());

            var name = $(this).data('value');
            restart_policy_dropdown_selected.data('name', name);
            if (name === 'on-failure')
                $("#restart-policy-retries-container").removeClass('hidden');
            else
                $("#restart-policy-retries-container").addClass('hidden');
        });
    }());

    /* When a duplicated field changes clear all related */
    $("#containers_run_image_dialog").on("change keypress", "input[duplicate]", function() {
        $(this)
            .removeAttr("duplicate")
            .closest(".containers-run-inline").find("input[duplicate]")
                .trigger("change");
    });

    $("#containers_run_image_dialog").on("show.bs.modal", function(ev) {
        var docker = client.instance();

        /* The image id this dialog was triggered for */
        var image_id = $(ev.relatedTarget).attr("data-image");
        image = docker.images[image_id];

        util.docker_debug("run-image", image);

        /* This slider is only visible if docker says this option is available */
        $("#containers-run-image-memory").toggle(!!docker.info.MemoryLimit);

        if (docker.info.MemTotal)
            memory_slider.max = docker.info.MemTotal;

        var id;
        for (id in docker.containers)
            container_names.push(util.render_container_name(docker.containers[id].Name));

        $('#select-linked-containers').empty();
        $("#link-containers").prop("checked", false);

        /* Memory slider defaults */
        if (image.ContainerConfig.Memory) {
            memory_slider.value = image.ContainerConfig.Memory;
        } else {
            /* First call sets the position of slider */
            memory_slider.value = 512*1024*1024;
            memory_slider.value = undefined;
        }

        /* CPU slider defaults */
        if (image.ContainerConfig.CpuShares) {
            cpu_slider.value = image.ContainerConfig.CpuShares;
        } else {
            cpu_slider.value = 1024;
            cpu_slider.value = undefined;
        }

        // from https://github.com/dotcloud/docker/blob/master/pkg/namesgenerator/names-generator.go

        var left = [
            "happy", "jolly", "dreamy", "sad", "angry", "pensive", "focused", "sleepy",
            "grave", "distracted", "determined", "stoic", "stupefied", "sharp", "agitated",
            "cocky", "tender", "goofy", "furious", "desperate", "hopeful", "compassionate",
            "silly", "lonely", "condescending", "naughty", "kickass", "drunk", "boring",
            "nostalgic", "ecstatic", "insane", "cranky", "mad", "jovial", "sick", "hungry",
            "thirsty", "elegant", "backstabbing", "clever", "trusting", "loving", "suspicious",
            "berserk", "high", "romantic", "prickly", "evil"
        ];

        var right = [
            "lovelace", "franklin", "tesla", "einstein", "bohr", "davinci", "pasteur", "nobel",
            "curie", "darwin", "turing", "ritchie", "torvalds", "pike", "thompson", "wozniak",
            "galileo", "euclid", "newton", "fermat", "archimedes", "poincare", "heisenberg",
            "feynman", "hawking", "fermi", "pare", "mccarthy", "engelbart", "babbage",
            "albattani", "ptolemy", "bell", "wright", "lumiere", "morse", "mclean", "brown",
            "bardeen", "brattain", "shockley"
        ];

        function make_name() {
            function ranchoice(array) {
                return array[Math.round(Math.random() * (array.length-1))];
            }
            return ranchoice(left) + "_" + ranchoice(right);
        }

        $("#containers-run-image").text(image.RepoTags[0]);
        $("#containers-run-image-name").val(make_name());
        var command_input = $("#containers-run-image-command");
        command_input.val(util.quote_cmdline(image.Config.Cmd));

        /* delete any old port mapping entries */
        var portmapping = $('#select-exposed-ports');
        portmapping.empty();

        /* show ports exposed by container image */
        var renderer = port_renderer();
        for (var p in image.Config.ExposedPorts)
            renderer(parseInt(p, 10), p.slice(-3), false);

        if (portmapping.children().length > 0) {
            $('#expose-ports').prop('checked', true);
            /* make sure the ports are visible */
            portmapping.show();
        } else {
            $('#expose-ports').prop('checked', false);
        }

        /* delete any old volume binding entries */
        var volume_binding = $('#select-mounted-volumes');
        volume_binding.empty();

        /* show volumes mounted by container image */
        var vrenderer = volume_renderer();
        for (var v in image.Config.Volumes)
            vrenderer(v, false);

        if (volume_binding.children().length > 0) {
            $('#mount-volumes').prop('checked', true);
            /* make sure the volumes are visible */
            volume_binding.show();
        } else {
            $('#mount-volumes').prop('checked', false);
        }

        /* delete any old env var claiming entries */
        var envvar_claiming = $('#select-claimed-envvars');
        envvar_claiming.empty();

        /* show envvars claimed by container image */
        var erenderer = envvar_renderer();
        for (var i=0, e; image.Config.Env && ( e = image.Config.Env[i++]);) {
            if (e && e.length > 0 && e.indexOf('=') > 0)
                erenderer(e.substr(0, e.indexOf('=')), e.substr(e.indexOf('=') + 1, e.length), false);
        }

        if (envvar_claiming.children().length > 0) {
            $('#claim-envvars').prop('checked', true);
            /* make sure the volumes are visible */
            envvar_claiming.show();
        } else {
            $('#claim-envvars').prop('checked', false);
        }

        var restart_policy_select_button = $('#restart-policy-select > button span.pull-left');
        restart_policy_select_button.text(_("No"));
        restart_policy_select_button.data('name', 'no');
        $('#restart-policy-retries').val('0');
        $('#restart-policy-retries-container').addClass('hidden');
    });

    $("#containers_run_image_dialog").on("hide.bs.modal", function(ev) {
        image = null;
    });

    function validate() {
        var exs = [];

        function add_port_message(port, message, is_container) {
            var ex = new Error(message);
            ex.target = port.parent();
            exs.push(ex);
        }

        /* check all exposed ports for duplicate port entries, invalid port numbers and empty fields */
        function check_port(ports, protocols, port_index, is_container) {
            var exposed_port = ports[port_index];
            var port_value = exposed_port.val();

            /* skip if empty */
            if (port_value === "")
                return;

            /* check for invalid port number */
            if (/\D/.test(port_value) || (port_value < 0) || (port_value > 65535)) {
                add_port_message(exposed_port, _("Invalid port"), is_container);
                return;
            }

            /* check for duplicate entries */
            for (var i = 0; i < ports.length; ++i) {
                if (i === port_index)
                    continue;
                var second_port = ports[i];
                if ((port_value === second_port.val()) && (protocols[port_index] === protocols[i])) {
                    add_port_message(exposed_port, _("Duplicate port"), is_container);
                    exposed_port.attr("duplicate", "true");
                    return;
                }
            }
        }

        function check_ports() {
            /* if #expose-ports isn't checked, then don't check for errors */
            if (!$('#expose-ports').prop('checked'))
                return;

            var exposed_ports = { 'container': [], 'host': [], 'protocol': [] };
            /* gather all ports */
            $('#select-exposed-ports').children('form').each(function() {
                var element = $(this);
                var input_ports = element.find('input');
                input_ports = [ $(input_ports[0]),  $(input_ports[1]) ];
                if ((input_ports[0].val() !== "") || (input_ports[1].val() !== "")) {
                    exposed_ports.container.push(input_ports[0]);
                    exposed_ports.host.push(input_ports[1]);
                    exposed_ports.protocol.push(element.find('button span').text().toLowerCase());
                }
            });

            $("#select-exposed-ports input").removeAttr("duplicate");

            /* check ports */
            for (var port_index = 0; port_index < exposed_ports.container.length; ++port_index) {
                check_port(exposed_ports.container, exposed_ports.protocol, port_index, true);
                check_port(exposed_ports.host, exposed_ports.protocol, port_index, false);
            }
        }

        function check_command() {
            var ex;

            /* if command is empty, show error */
            if ($('#containers-run-image-command').val() === "") {
                ex = new Error(_("Command can't be empty"));
                ex.target = "#containers-run-image-command";
            }
        }

        function add_link_message(control, message) {
            var ex = new Error(message);
            ex.target = control.parent();
            exs.push(ex);
        }

        function check_alias(aliases, alias_index) {
            var alias = aliases[alias_index];
            var alias_value = alias.val();

            /* check for empty field */
            if (alias_value === "") {
                /* still valid if empty */
                add_link_message(alias, _("No alias specified"));
                return;
            }

            /* check for duplicate entries */
            for (var i = 0; i < aliases.length; ++i) {
                if (i === alias_index)
                    continue;
                var second_alias = aliases[i];
                if ((alias_value === second_alias.val())) {
                    add_link_message(alias, _("Duplicate alias"));
                    alias.attr("duplicate", "true");
                    return;
                }
            }
        }

        function check_links() {
            /* if #link-containers isn't checked, then don't check for errors */
            if (!$('#link-containers').prop('checked'))
                return;

            var aliases = [];

            /* gather all aliases */
            $('#select-linked-containers').children('form').each(function() {
                var element = $(this);
                var container = element.find('button span');
                var containername = container[0].nodeValue;
                var alias = element.find('input[name="alias"]');

                if ((alias.val() !== "") || (containername !== "")) {
                    if (containername === "")
                        add_link_message(container, _("No container specified"));
                    aliases.push(alias);
                }
            });

            $("#select-linked-containers input").removeAttr("duplicate");

            /* check aliases */
            for (var alias_index = 0; alias_index < aliases.length; ++alias_index)
                check_alias(aliases, alias_index);
        }

        check_ports();
        check_command();
        check_links();

        return exs.length ? exs : null;
    }

    function port_renderer() {
        var template = $("#port-expose-tmpl").html();
        Mustache.parse(template);

        function add_row() {
            render();
        }

        function remove_row(e) {
            var parent = $(e.target).closest("form");
            parent.remove();
            var children = $('#select-exposed-ports').children();
            if (children.length === 0)
                $("#expose-ports").attr("checked", false);
            else
                children.find("input[duplicate]").trigger("change");
        }

        function render(port_internal, port_protocol, port_internal_editable) {
            if (port_internal === undefined)
                port_internal = '';
            if (port_protocol === undefined)
                port_protocol = 'TCP';
            if (port_internal_editable === undefined)
                port_internal_editable = true;

            var row = $(Mustache.render(template, {
                host_port_label: _("to host port"),
                placeholder: _("none"),
            }));
            row.children("button.fa-plus").on('click', add_row);
            if (port_internal_editable) {
                row.children("button.pficon-close").on('click', remove_row);
            } else {
                row.children("button.pficon-close").attr('disabled', true);
            }

            var row_container_input = row.find('input[name="container"]');
            row_container_input.val(port_internal);
            if (!port_internal_editable)
                row_container_input.attr('disabled', true);

            var protocol_select = row.find("div .port-expose-protocol");
            if (port_internal_editable) {
                protocol_select.find("a").on('click', function() {
                    protocol_select.find("button span").text($(this).text());
                });
            } else {
                protocol_select.attr('disabled', true);
            }

            protocol_select.find("button span").text(port_protocol.toUpperCase());
            $("#select-exposed-ports").append(row);
        }

        return render;
    }

    function volume_renderer() {
        var template = $("#volume-mount-tmpl").html();
        Mustache.parse(template);

        function add_row() {
            render();
        }

        function remove_row(e) {
            var parent = $(e.target).closest("form");
            parent.remove();
            var children = $('#select-mounted-volumes').children();
            if (children.length === 0)
                $("#mount-volumes").attr("checked", false);
            else
                children.find("input[duplicate]").trigger("change");
        }

        function render(volume_internal, volume_internal_editable) {
            if (volume_internal === undefined)
                volume_internal = '';
            if (volume_internal_editable === undefined)
                volume_internal_editable = true;

            var row = $(Mustache.render(template, {
                host_volume_label: _("to host path"),
                placeholder: _("none")
            }));
            row.children("button.fa-plus").on('click', add_row);
            if (volume_internal_editable) {
                row.children("button.pficon-close").on('click', remove_row);
            } else {
                row.children("button.pficon-close").attr('disabled', true);
            }

            var row_container_input = row.find('input[name="container"]');
            row_container_input.val(volume_internal);
            if (!volume_internal_editable)
                row_container_input.attr('disabled', true);

            var mount_mode_select = row.find("div .mount-mode");
            mount_mode_select.find('a').on('click', function() {
                mount_mode_select.find("button span").text($(this).text());
            });

            $("#select-mounted-volumes").append(row);
        }

        return render;
    }

    function envvar_renderer() {
        var template = $("#envvar-claim-tmpl").html();
        Mustache.parse(template);

        function add_row() {
            render();
        }

        function remove_row(e) {
            var parent = $(e.target).closest("form");
            parent.remove();
            var children = $('#select-claimed-envvars').children();
            if (children.length === 0)
                $("#claim-envvars").attr("checked", false);
            else
                children.find("input[duplicate]").trigger("change");
        }

        function render(envvar_key_internal, envvar_value_internal, envvar_internal_editable) {
            if (envvar_key_internal === undefined)
                envvar_key_internal = '';
            if (envvar_value_internal === undefined)
                envvar_value_internal = '';
            if (envvar_internal_editable === undefined)
                envvar_internal_editable = true;

            var row = $(Mustache.render(template, {
                envvar_key_label: _("key"),
                envvar_value_label: _("value"),
                placeholder: _("none")
            }));
            row.children("button.fa-plus").on('click', add_row);
            if (envvar_internal_editable) {
                row.children("button.pficon-close").on('click', remove_row);
            } else {
                row.children("button.pficon-close").attr('disabled', true);
            }

            var row_envvar_key_input = row.find('input[name="envvar_key"]');
            row_envvar_key_input.val(envvar_key_internal);
            if (!envvar_internal_editable)
                row_envvar_key_input.attr('disabled', true);

            var row_envvar_value_input = row.find('input[name="envvar_value"]');
            row_envvar_value_input.val(envvar_value_internal);
            if (!envvar_internal_editable)
                row_envvar_value_input.attr('disabled', true);

            $("#select-claimed-envvars").append(row);
        }

        return render;
    }

    function link_renderer() {
        var template = $("#container-link-tmpl").html();
        Mustache.parse(template);

        function add_row() {
            render();
        }

        function remove_row(e) {
            var parent = $(e.target).closest("form");
            parent.remove();
            var children = $('#select-linked-containers').children();
            if (children.length === 0)
                $("#link-containers").attr("checked", false);
            else
                children.find("input[duplicate]").trigger("change");
        }

        function render(containers) {
            var row = $(Mustache.render(template, {
                containers: container_names,
                alias_label: _("alias"),
                placeholder: _("none")
            }));
            row.children("button.fa-plus").on('click', add_row);
            row.children("button.pficon-close").on('click', remove_row);
            var container_select = row.find("div .link-container");
            container_select.find('a').on('click', function() {
                container_select.find("button span").text($(this).text());
            });
            $("#select-linked-containers").append(row);
        }

        return render;
    }

    $("#containers-run-image-run").on('click', function() {
        var exs = validate();
        if (exs) {
            $("#containers_run_image_dialog").dialog('failure', exs);
            return;
        }

        var name = $("#containers-run-image-name").val();
        var cmd = $("#containers-run-image-command").val();
        var port_bindings = { };
        var volume_bindings = [ ];
        var map_from, map_to, map_protocol;
        var mount_from, mount_to, mount_mode;
        var links = [];
        var exposed_ports = { };
        var claimed_envvars = [ ];
        if ($('#expose-ports').prop('checked')) {
            $('#select-exposed-ports').children('form').each(function() {
                var input_ports = $(this).find('input').map(function(idx, elem) {
                    return $(elem).val();
                }).get();
                map_from = input_ports[0];
                map_to = input_ports[1];
                map_protocol = $(this).find('button span').text().toLowerCase();

                if (map_from !== '' && map_to !== '') {
                    port_bindings[map_from + '/' + map_protocol] = [ { "HostPort": map_to } ];
                    exposed_ports[map_from + '/' + map_protocol] = { };
                }
            });
        }

        if ($('#mount-volumes').prop('checked')) {
            $('#select-mounted-volumes').children('form').each(function() {
                var input_volumes = $(this).find('input').map(function(idx, elem) {
                    return $(elem).val();
                }).get();
                mount_from = input_volumes[0];
                mount_to = input_volumes[1];
                var mount_mode_text = $(this).find('button span').text();
                switch (mount_mode_text) {
                    case 'ReadOnly':
                        mount_mode = 'ro';
                        break;
                    case 'ReadWrite':
                        mount_mode = 'rw';
                        break;
                    default:
                        mount_mode = '';
                        break;
                }

                if (mount_from === '' || mount_to === '')
                    return;

                if (mount_mode === '') {
                    volume_bindings.push(mount_to + ':' + mount_from);
                } else {
                    volume_bindings.push(mount_to + ':' + mount_from + ':' + mount_mode);
                }
            });
        }

        if ($('#claim-envvars').prop('checked')) {
            $('#select-claimed-envvars').children('form').each(function() {
                var input_envvars = $(this).find('input').map(function(idx, elem) {
                    return $(elem).val();
                }).get();
                var claim_key = input_envvars[0];
                var claim_value = input_envvars[1];

                if (claim_key === '' || claim_value === '')
                    return;

                claimed_envvars.push(claim_key + '=' + claim_value);
            });
        }

        if ($("#link-containers").prop('checked')) {
            $("#select-linked-containers form").each(function() {
                var element = $(this);
                var container = element.find('button span').text();
                var alias = element.find('input[name="alias"]').val();
                if (container && alias)
                    links.push(container + ':' + alias);
            });
        }

        var tty = $("#containers-run-image-with-terminal").prop('checked');

        var options = {
            "Cmd": util.unquote_cmdline(cmd),
            "Image": image.Id,
            "CpuShares": cpu_slider.value || 0,
            "Tty": tty,
            "ExposedPorts": exposed_ports,
            "Env": claimed_envvars,
            "HostConfig": {
                "PortBindings": port_bindings,
                "Binds": volume_bindings,
                "Links": links,
                "RestartPolicy": {
                    "Name": $("#restart-policy-select > button span.pull-left").data('name'),
                    "MaximumRetryCount": parseInt($("#restart-policy-retries").val(), 10) || 0
                }
            }
        };

        var docker = client.instance();

        /* Only set these fields if supported by docker */
        if (docker.info.MemoryLimit) {
            options.Memory = memory_slider.value || 0;
            options.MemorySwap = (memory_slider.value * 2) || 0;
        }

        if (tty) {
            $.extend(options, {
                "AttachStderr": true,
                "AttachStdin": true,
                "AttachStdout": true,
                "OpenStdin": true,
                "StdinOnce": true
            });
        }

        var promise = docker.create(name, options).
            then(function(result) {
                return docker.start(result.Id);
            });

        $("#containers_run_image_dialog").dialog("promise", promise);
    });
});
