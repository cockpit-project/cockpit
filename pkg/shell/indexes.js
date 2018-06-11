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

(function() {
    "use strict";

    var $ = require("jquery");
    var cockpit = require("cockpit");

    var base_index = require("./base_index");

    var _ = cockpit.gettext;

    var shell_embedded = window.location.pathname.indexOf(".html") !== -1;

    function MachinesIndex(index_options, machines, loader, mdialogs) {
        if (!index_options)
            index_options = {};

        index_options.navigate = function (state, sidebar) {
            return navigate(state, sidebar);
        };
        var index = base_index.new_index_from_proto(index_options);

        /* Restarts */
        $(index).on("expect_restart", function (ev, host) {
            loader.expect_restart(host);
        });

        /* Disconnection Dialog */
        var watchdog_problem = null;
        $(index).on("disconnect", function (ev, problem) {
            watchdog_problem = problem;
            show_disconnected();
        });

        /* Is troubleshooting dialog open */
        var troubleshooting = false;
        var machines_timer = null;

        $("#machine-dropdown").on("hide.bs.dropdown", function () {
            $("#find-machine").val("");
            $("#machine-dropdown ul li").toggleClass("hidden", false);
        });

        $("#find-machine").on("keyup", function (ev) {
            if (machines_timer)
                window.clearTimeout(machines_timer);

            machines_timer = window.setTimeout(function () {
                filter_machines();
                machines_timer = null;
            }, 250);
        });

        $("#host-nav-item").on("click", function (ev) {
            if ($(this).hasClass("active")) {
                $(this).toggleClass("menu-visible");
                $("#host-nav").toggleClass("interact");
                ev.preventDefault();
                return false;
            } else {
                $(this).toggleClass("menu-visible", true);
                $("#host-nav").toggleClass("interact", true);
            }
        });

        /* Reconnect button */
        $("#machine-reconnect").on("click", function(ev) {
            if (watchdog_problem) {
                cockpit.sessionStorage.clear();
                window.location.reload(true);
            } else {
                navigate(null, true);
            }
        });

        /* Troubleshoot pause navigation */
        $("#troubleshoot-dialog").on("show.bs.modal", function(ev) {
            troubleshooting = true;
        });

        /* Troubleshoot dialog close */
        $("#troubleshoot-dialog").on("hide.bs.modal", function(ev) {
            troubleshooting = false;
            navigate(null, true);
        });

        /* Navigation */
        var ready = false;
        function on_ready() {
            ready = true;
            index.ready();
        }

        /* When the machine list is ready we start processing navigation */
        $(machines)
            .on("ready", on_ready)
            .on("added updated", function(ev, machine) {
                if (!machine.visible)
                    index.frames.remove(machine);
                else if (machine.problem)
                    index.frames.remove(machine);

                update_machines();
                if (ready)
                    navigate();
            })
            .on("removed", function(ev, machine) {
                index.frames.remove(machine);
                update_machines();
            });

        if (machines.ready)
            on_ready();

        /* When only one machine this operates as a link */
        $("#machine-link").on("click", function(ev) {
            if (machines.list.length == 1) {
                index.jump({ host: machines.list[0].address, sidebar: true, component: "" });
                ev.preventDefault();
                return false;
            }
        });

        function show_disconnected() {
            var current_frame = index.current_frame();

            if (current_frame)
                $(current_frame).hide();

            $(".curtains-ct .spinner").toggle(false);
            $("#machine-reconnect").toggle(true);
            $("#machine-troubleshoot").toggle(false);
            $(".curtains-ct i").toggle(true);
            $(".curtains-ct h1").text(_("Disconnected"));
            $(".curtains-ct p").text(cockpit.message(watchdog_problem));
            $(".curtains-ct").show();
            $("#navbar-dropdown").addClass("disabled");
        }

        /* Handles navigation */
        function navigate(state, reconnect) {
            var machine;
            $('#host-nav-item').toggleClass("menu-visible", false);
            $("#host-nav").toggleClass("interact", false);

            /* If this is a watchdog problem or we are troubleshooting
             * let the dialog handle it */
            if (watchdog_problem || troubleshooting)
                return;

            /* phantomjs has a problem retrieving state, so we allow it to be passed in */
            if (!state)
                state = index.retrieve_state();
            machine = machines.lookup(state.host);

            /* No such machine */
            if (!machine) {
                machine = {
                    key: state.host,
                    address: state.host,
                    label: state.host,
                    state: "failed",
                    problem: "not-found",
                };

            /* Asked to reconnect to the machine */
            } else if (!machine.visible) {
                machine.state = "failed";
                machine.problem = "not-found";
            } else if (reconnect && machine.state !== "connected") {
                loader.connect(state.host);
            }

            var compiled = compile(machine);
            if (machine.manifests && !state.component)
                state.component = choose_component(state, compiled);

            update_navbar(machine, state, compiled);
            update_frame(machine, state, compiled);

            /* Just replace the state, and URL */
            index.jump(state, true);
        }

        function choose_component(state, compiled) {
            var item, menu_items;
            var single_host = machines.list.length <= 1;
            var dashboards = compiled.ordered("dashboard");

            if (shell_embedded)
                state.sidebar = true;

            /* See if we should show a dashboard */
            if (!state.sidebar && dashboards.length > 0) {
                item = dashboards[0];
                /* Don't chose a dashboard as a single host unless
                 * it specifically supports that.
                 */
                if (item && (!single_host || item.wants !== "multiple-machines"))
                    return item.path;
                else
                    item = null;
            }

            /* See if we can find something with currently selected label */
            var label = $("#sidebar li.active a").text();
            if (label) {
                item = compiled.search("label", label);
                if (item)
                    return item.path;
            }

            /* Go for the first item */
            menu_items = compiled.ordered("menu");
            if (menu_items.length > 0 && menu_items[0]) {
                return menu_items[0].path;

            /* If there is no menu items use a dashboard */
            } else if (dashboards.length > 0) {
                item = dashboards[0];
                if (item) {
                    state.sidebar = false;
                    return item.path;
                }
            }

            return "system";
        }

        function default_machine() {
            /* Default to localhost if it has anything.
             * Otherwise find the first non local machine.
             */
            var i;
            var machine = machines.lookup("localhost");
            var compiled = compile(machine);
            if (compiled.ordered("menu").length || compiled.ordered("tools").length)
                return machine;

            for (i = 0; i < machines.list.length; i++) {
                if (machines.list[i].address != "localhost")
                    return machines.list[i];
            }
        }

        function update_sidebar(machine, state, compiled) {
            function links(component) {
                var active = state.component === component.path;
                var listItem;

                listItem = $("<li class='list-group-item'>")
                    .toggleClass("active", active)
                    .append($("<a>")
                        .attr("href", index.href({ host: machine.address, component: component.path, hash: component.hash }))
                        .append($("<span>").text(component.label)));

                if (active)
                    listItem.find('a').attr("aria-current", "page");

                return listItem;
            }

            var menu = compiled.ordered("menu").map(links);
            $("#sidebar-menu").empty().append(menu);

            var tools = compiled.ordered("tools").map(links);
            $("#sidebar-tools").empty().append(tools);

            $("#machine-avatar").attr("src", machine && machine.avatar ? encodeURI(machine.avatar) :
                                                "../shell/images/server-small.png");

            var color = machine && machine.color || "";
            $("#host-nav-item span.pficon-container-node").css("color", color);

            if (machine) {
                $("#machine-link span").text(machine.label);
                $("#machine-link").attr("title", machine.label);
            } else {
                $("#machine-link span").text(_("Machines"));
                $("#machine-link").attr("title", "");
            }
        }

        function update_active_machine (address) {
            var active_sel;
            $("#machine-dropdown ul li").toggleClass("active", false)
                .find("a").removeAttr("aria-current");
            if (address) {
                active_sel = "#machine-dropdown ul li[data-address='" + address + "']";
                $(active_sel).toggleClass("active", true)
                    .find("a").attr("aria-current", "page");
            }
        }

        function update_machine_links(machine, showing_sidebar, state) {
            var data = $("#host-nav-link").attr("data-machine");

            // If we are already setup we will bail early
            if (data && (!machine || machine.address === data)) {
                // If showing the sidebar, save our place
                if (showing_sidebar) {
                    $("#host-nav-link").attr("href", index.href(state));
                    update_active_machine(data);
                }
                return;
            }

            if (!machine && data)
                machine = machines.lookup(data);
            if (!machine)
                machine = default_machine();

            $("#host-nav-link span.list-group-item-value").text(machine ? machine.label : "");
            $("#host-nav-link")
                .attr("aria-label", _("Host"))
                .attr("data-machine", machine ? machine.address : "")
                .attr("href", index.href({ host: machine ? machine.address : undefined }, true));

            // Only show the hosts icon in the main nav if we have a machine
            $("#host-nav-item").toggleClass("dashboard-link", !!machine);

            update_active_machine(machine ? machine.address : null);
        }

        function update_navbar(machine, state, compiled) {
            /* When a dashboard no machine or sidebar */
            var item = compiled.items[state.component];
            if (item && item.section == "dashboard") {
                delete state.sidebar;
                machine = null;
            }

            $(".dashboard-link").each(function() {
                var el = $(this);
                var data = el.attr("data-component");
                // Mark active component and save our place
                if (data && data === state.component) {
                    el.attr("href", index.href(state))
                        .toggleClass("active", true)
                        .find("a").attr("aria-current", "page");
                } else {
                    el.toggleClass("active", false)
                        .find("a").removeAttr("aria-current");
                }
            });

            $("#host-nav-item").toggleClass("active", !!machine);
            if (machine)
                update_sidebar(machine, state, compiled);

            $("#host-nav").toggleClass("hidden", !machine);
            update_machine_links(machine, !!machine, state);
            $('.area-ct-body').toggleClass("single-nav", $(".dashboard-link").length < 2);
        }

        function update_title(label, machine) {
            var compiled;
            if (label)
                label += " - ";
            else
                label = "";
            var suffix = index.default_title;

            if (machine) {
                if (machine.address === "localhost") {
                    compiled = compile(machine);
                    if (compiled.ordered("menu").length || compiled.ordered("tools").length)
                        suffix = machine.label;
                } else {
                    suffix = machine.label;
                }
            }
            document.title = label + suffix;
        }

        function update_frame(machine, state, compiled) {
            var title, message, connecting, restarting;
            var current_frame = index.current_frame();

            if (machine.state != "connected") {
                $(current_frame).hide();
                current_frame = null;
                index.current_frame(current_frame);

                connecting = (machine.state == "connecting");
                if (machine.restarting) {
                    title = _("The machine is restarting");
                    message = "";
                } else if (connecting) {
                    title = _("Connecting to the machine");
                    message = "";
                } else {
                    title = _("Couldn't connect to the machine");
                    if (machine.problem == "not-found") {
                        message = _("Cannot connect to an unknown machine");
                    } else {
                        var error = machine.problem || machine.state;
                        if (error)
                            message = cockpit.message(error);
                        else
                            message = "";
                    }
                }

                if (!machine.restarting && mdialogs.needs_troubleshoot(machine)) {
                    $("#machine-troubleshoot").off()
                        .on("click", function () {
                            mdialogs.troubleshoot("troubleshoot-dialog", machine);
                        });
                    $("#machine-troubleshoot").show();
                } else {
                    $("#machine-troubleshoot").hide();
                }

                restarting = !!machine.restarting;
                $(".curtains-ct").show();
                $(".curtains-ct .spinner").toggle(connecting || restarting);
                $("#machine-reconnect").toggle(!connecting && machine.problem != "not-found");
                $(".curtains-ct i").toggle(!connecting && !restarting);
                $(".curtains-ct h1").text(title);
                $(".curtains-ct p").text(message);

                $("#machine-spinner").hide();

                update_title(null, machine);

                /* Fall through when connecting, and allow frame to load at same time*/
                if (!connecting)
                    return;
            }

            var hash = state.hash;
            var component = state.component;

            /* Old cockpit packages, used to be in shell/shell.html */
            var compat;
            if (machine && compiled.compat) {
                compat = compiled.compat[component];
                if (compat) {
                    component = "shell/shell";
                    hash = compat;
                }
            }

            var frame;
            if (component)
                frame = index.frames.lookup(machine, component, hash);
            if (frame != current_frame) {
                $(current_frame).css('display', 'none');
                index.current_frame(frame);
            }

            var label, item;
            if (machine.state == "connected") {
                $(".curtains-ct").hide();
                $("#machine-spinner").toggle(frame && !$(frame).attr("data-ready"));
                $(frame).css('display', 'block');
                item = compiled.items[state.component];
                label = item ? item.label : "";
                update_title(label, machine);
            }
        }

        function update_machines() {
            $("#machine-dropdown .caret")
                .toggle(machines.list.length > 1);

            var machine_link = $("#machine-link");
            if (machines.list.length > 1)
                machine_link.attr("data-toggle", "dropdown");
            else
                machine_link.removeAttr("data-toggle");

            var list = $("#machine-dropdown ul");
            var links = machines.list.map(function(machine) {
                var text = $("<span>")
                    .text(machine.label)
                    .prepend($("<i>")
                        .attr("class", "fa-li fa fa-circle")
                        .css("color", machine.color || ""));
                return $("<li role='presentation'>")
                    .attr("data-address", machine.address)
                    .append($("<a>")
                        .attr("role", "menuitem")
                        .attr("tabindex", "-1")
                        .attr("data-address", machine.address)
                        .attr("href", index.href({ host: machine.address }, true))
                        .append(text));
                });
            list.empty().append(links);
        }

        function filter_machines () {
            var val = $("#find-machine").val().toLowerCase();
            $("#machine-dropdown ul li").each(function() {
                var el = $(this);
                var a = el.find('a').first();
                var txt = a.text().toLowerCase();
                var addr = a.attr("data-address") ? a.attr("data-address").toLowerCase() : "";
                var hide = !!val && txt.indexOf(val) !== 0 && addr.indexOf(val) !== 0;
                el.toggleClass("hidden", hide);
            });
        }

        function compatibility(machine) {
            if (!machine.manifests || machine.address === "localhost")
                return null;

            var shell = machine.manifests["shell"] || { };
            var menu = shell["menu"] || { };
            var tools = shell["tools"] || { };

            var mapping = { };

            /* The following were included in shell/shell.html in old versions */
            if ("_host_" in menu)
                mapping["system/host"] = "/server";
            if ("_init_" in menu)
                mapping["system/init"] = "/services";
            if ("_network_" in menu)
                mapping["network/interfaces"] = "/networking";
            if ("_storage_" in menu)
                mapping["storage/devices"] = "/storage";
            if ("_users_" in tools)
                mapping["users/local"] = "/accounts";

            /* For Docker we have to guess ... some heuristics */
            if ("_storage_" in menu || "_init_" in menu)
                mapping["docker/containers"] = "/containers";

            return mapping;
        }

        function compile(machine) {
            var compiled = base_index.new_compiled();
            compiled.load(machine.manifests, "tools");
            compiled.load(machine.manifests, "dashboard");
            compiled.load(machine.manifests, "menu");
            compiled.compat = compatibility(machine);
            return compiled;
        }

        cockpit.transport.wait(function() {
            index.start();
        });
    }

    function SimpleIndex(index_options) {
        if (!index_options)
            index_options = {};

        index_options.navigate = function (state, sidebar) {
            return navigate(state, sidebar);
        };
        var default_title = index_options.default_title || "Cockpit";
        var index = base_index.new_index_from_proto(index_options);
        var compiled = base_index.new_compiled();

        compiled.load(cockpit.manifests, "dashboard");

        /* Disconnection Dialog */
        var watchdog_problem = null;
        $(index).on("disconnect", function (ev, problem) {
            watchdog_problem = problem;
            show_disconnected();
        });

        /* Reconnect button */
        $("#machine-reconnect").on("click", function(ev) {
            cockpit.sessionStorage.clear();
            window.location.reload(true);
        });

        function show_disconnected() {
            var current_frame = index.current_frame();
            if (current_frame)
                $(current_frame).hide();

            $(".curtains-ct .spinner").toggle(false);
            $("#machine-reconnect").toggle(true);
            $(".curtains-ct i").toggle(true);
            $(".curtains-ct h1").text(_("Disconnected"));
            $(".curtains-ct p").text(cockpit.message(watchdog_problem));
            $(".curtains-ct").show();
            $("#navbar-dropdown").addClass("disabled");
        }

        index.ready();

        /* Handles navigation */
        function navigate(state, reconnect) {
            var dashboards = compiled.ordered("dashboard");

            /* If this is a watchdog problem or we are troubleshooting
             * let the dialog handle it */
            if (watchdog_problem)
                return;

            /* phantomjs has a problem retrieving state, so we allow it to be passed in */
            if (!state)
                state = index.retrieve_state();

            if (!state.component && dashboards.length > 0) {
                state.component = dashboards[0].path;
            }
            update_navbar(state);
            update_frame(state);

            /* Just replace the state, and URL */
            index.jump(state, true);
        }

        function update_navbar(state) {
            $("#host-nav-item").toggleClass("dashboard-link", false);
            $(".dashboard-link").each(function() {
                var el = $(this);
                el.toggleClass("active", el.attr("data-component") === state.component);
            });

            var item = compiled.items[state.component];
            if (item && item.section == "dashboard")
                delete state.sidebar;

            $('.area-ct-body').toggleClass("single-nav", $(".dashboard-link").length < 2);

        }

        function update_title(label) {
            if (label)
                label += " - ";
            else
                label = "";
            document.title = label + default_title;
        }

        function update_frame(state) {
            var current_frame = index.current_frame();

            var hash = state.hash;
            var component = state.component;

            var frame;
            if (component)
                frame = index.frames.lookup(null, component, hash);
            if (frame != current_frame) {
                $(current_frame).css('display', 'none');
                index.current_frame(frame);
            }

            var label, item;
            $(frame).css('display', 'block');
            item = compiled.items[state.component];
            label = item ? item.label : "";
            update_title(label);
        }

        cockpit.transport.wait(function() {
            index.start();
        });
    }

    module.exports = {
        simple_index: function (options) {
            return new SimpleIndex(options);
        },
        machines_index: function (options, machines_ins, loader, mdialogs) {
            return new MachinesIndex(options, machines_ins, loader, mdialogs);
        }
    };

    function message_queue(event) {
        window.messages.push(event);
    }

    /* When we're being loaded into the index window we have additional duties */
    if (document.documentElement.getAttribute("class") === "index-page") {
        /* Indicates to child frames that we are a cockpit1 router frame */
        window.name = "cockpit1";

        /* The same thing as above, but compatibility with old cockpit */
        window.options = { sink: true, protocol: "cockpit1" };

        /* While the index is initializing, snag any messages we receive from frames */
        window.messages = [ ];

        window.messages.cancel = function() {
            window.removeEventListener("message", message_queue, false);
            window.messages = null;
        };

        window.addEventListener("message", message_queue, false);
    }

}());
