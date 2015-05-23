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

var phantom_checkpoint = phantom_checkpoint || function () { };

define([
    "jquery",
    "base1/cockpit",
    "shell/machines",
    'translated!base1/po',
    "manifests"
], function($, cockpit, machis, po, local_manifests) {

    cockpit.locale(po);
    var _ = cockpit.gettext;

    var default_title = "Cockpit";

    /* The oops bar */

    var oops = null;
    function setup_oops() {
        if (oops)
            return true;
        oops = $("#navbar-oops");
        if (!oops)
            return false;
        oops.children("a").on("click", function() {
            $("#error-popup-title").text(_("Unexpected error"));
            var details = _("Cockpit had an unexpected internal error. <br/><br/>") +
                          _("You can try restarting Cockpit by pressing refresh in your browser. ") +
                          _("The javascript console contains details about this error ") +
                          _("(<b>Ctrl-Shift-J</b> in most browsers).");
            $("#error-popup-message").html(details);
            $('#error-popup').modal('show');
        });
        return true;
    }

    if (window.navigator.userAgent.indexOf("PhantomJS") == -1) {
        var old_onerror = window.onerror;
        window.onerror = function cockpit_error_handler(msg, url, line) {
            if (setup_oops())
                oops.show();
            phantom_checkpoint();
            if (old_onerror)
                return old_onerror(msg, url, line);
            return false;
        };
    }

    /* Branding */

    function brand(id) {
        var os_release = JSON.parse(window.localStorage['os-release'] || "{}");

        var elt = $(id)[0];
        if (!elt)
            return;

        var len, content = window.getComputedStyle(elt).content;
        if (content && content != "none") {
            len = content.length;
            if ((content[0] === '"' || content[0] === '\'') &&
                len > 2 && content[len - 1] === content[0])
                content = content.substr(1, len - 2);
            elt.innerHTML = cockpit.format(content, os_release) || default_title;
            default_title = $(elt).text();
        }
    }

    brand('#index-brand');

    /* Basic menu items */

    $("#deauthorize-item").on("click", function(ev) {
        cockpit.drop_privileges(false);
        $("#deauthorize-item")
            .attr("disabled", "disabled")
            .addClass("disabled")
            .off("click");
        ev.preventDefault();
        phantom_checkpoint();
    });
    $("#go-logout").on("click", function() {
        cockpit.logout();
    });
    $("#go-account").on("click", function() {
        cockpit.location.go([ "@localhost", "users", "local", cockpit.user["user"] ]);
    });

    /* User name and menu */

    function update_user(first) {
        var str = cockpit.user["name"] || cockpit.user["user"];
        if (!str)
            str = first ? "" : "???";
        $('#content-user-name').text(str);

        var is_root = (cockpit.user["user"] == "root");
        var is_not_root = (cockpit.user["user"] && !is_root);
        $('#deauthorize-item').toggle(is_not_root);
    }

    $(cockpit.user).on("changed", update_user);
    update_user(true);

    /* Display language dialog */

    /*
     * Note that we don't go ahead and load all the po files in order
     * to produce this list. Perhaps we would include it somewhere in a
     * separate automatically generated file. Need to see.
     */
    var manifest = local_manifests["shell"] || { };
    $.each(manifest.linguas, function(code, name) {
        var el = $("<option>").text(name).val(code);
        if (code == cockpit.language)
            el.attr("selected", "true");
        $("#display-language-list").append(el);
    });

    $("#display-language-select-button").on("click", function(event) {
        var code_to_select = $("#display-language-list").val();
        window.localStorage.setItem("cockpit.lang", code_to_select);
        window.location.reload(true);
        return false;
    });

    $("display-language").on("shown.bs.modal", function() {
        $("display-language-list").focus();
        phantom_checkpoint();
    });

    /* About dialog */

    $(cockpit.info).on("changed", function() {
        $("#about-version").text(cockpit.info.version);
        phantom_checkpoint();
    });

    /* Disconnected dialog */

    var watchdog_problem = null;

    $("#disconnected-dialog").on("show.bs.modal", function() {
        /* Try to reconnect right away ... so that reconnect button has a chance */
        cockpit.channel({ payload: "null" });
        $('#disconnected-error').text(cockpit.message(watchdog_problem));
        phantom_checkpoint();
    });

    $('#disconnected-reconnect').on("click", function() {
        /*
         * If the connection was interrupted, but cockpit-ws is still running,
         * then it still has our session. The dummy cockpit.channel() above tried
         * to reestablish a connection with the same credentials.
         *
         * So if that works, this should reload the current page and get back to
         * where the user was right away. Otherwise this sends the user back
         * to the login screen.
         */
        window.sessionStorage.clear();
        window.location.reload(false);
    });

    $('#disconnected-logout').on("click", function() {
        cockpit.logout();
        phantom_checkpoint();
    });

    var watchdog = cockpit.channel({ "payload": "null" });
    $(watchdog).on("close", function(event, options) {
        watchdog_problem = options.problem || "disconnected";
        console.warn("transport closed: " + watchdog_problem);
        $('.modal[role="dialog"]').modal('hide');
        $('#disconnected-dialog').modal('show');
        phantom_checkpoint();
    });

    /* Navigation */

    var current_frame = null;
    var current_location;
    var current_hash;
    var current_address;

    var ready = false;
    var machines = machis.instance();
    var loader = machis.loader(machines);
    var frames = new Frames();
    var router = new Router();

    /* When the machine list is ready we start processing navigation */
    $(machines)
        .on("ready", function(ev) {
            ready = true;
            $(cockpit).on("locationchanged", function () {
                navigate(true);
            });
            build_navbar();
            navigate(false);
            $("body").show();
            phantom_checkpoint();
        })
        .on("added updated", function(ev, machine) {
            if (!machine.visible)
                frames.remove(machine);

            if (machine.problem)
                frames.remove(machine);

            update_machines();
            if (ready)
                navigate(false);
        })
        .on("removed", function(ev, machine) {
            frames.remove(machine);
            update_machines();
        });

    /* This works around issues with <base> tag and hash links */
    $(document).on("click", "a[href]", function(ev) {
        var href = $(ev.target).attr("href");
        if (href && href.indexOf("#") === 0) {
            cockpit.location = href.substring(1);
            return false;
        }
        return true;
    });

    /* This works around issues with <base> tag and hash links */
    $(document).on("click", "#machine-dropdown li a", function(ev) {
        var address = $(this).attr("data-address");
        if (!address)
            return true;

        var path = cockpit.location.path;
        if (path[0] && path[0][0] == '@') {
            path[0] = "@" + address;
            cockpit.location.go(path, cockpit.location.options);
        } else {
            cockpit.location = "/@" + address;
        }
        phantom_checkpoint();
        return true;
    });

    /* When only one machine this operates as a link */
    $("#machine-link").on("click", function(ev) {
        if (machines.list.length == 1) {
            cockpit.location = "/@" + machines.list[0].address;
            return false;
        }
    });

    /* Reconnect button */
    $(".curtains button").on("click", function(ev) {
        loader.connect(current_address);
    });

    function navigate(reconnect) {
        var path = cockpit.location.path.slice();
        var options = cockpit.location.options;

        var address = null;
        var machine = null;

        /* If this is a watchdog problem let the dialog handle it */
        if (watchdog_problem)
            return;

        /* Main dashboard listing */
        var listing = local_manifests["dashboard"];

        var at = 0;
        if (path.length === at) {

            /*
             * When more than one machine, we show dashboard by default
             * otherwise we show the server
             */
            if (!listing || machines.list.length <= 1)
                path.push("@localhost");
        }

        if (path[at] && path[at][0] == '@') {
            address = path[at].substring(1);
            at++;
        }

        if (address) {
            machine = machines.lookup(address);
            if (!machine) {
                machine = {
                    key: address,
                    address: address,
                    label: address,
                    state: "failed",
                    problem: "not-found"
                };
            } else if (reconnect && machine.problem) {
                loader.connect(address);
            }

            /* The default is to show the server */
            if (path.length === at)
                path.push.apply(path, ["system", "host"]);
        } else {

            /* The default is to show main dashboard */
            if (path.length === at)
                path.push.apply(path, ["dashboard", "list"]);
        }

        if (path.length == at + 1)
            path.push("index");

        var component = path[at] + "/" + path[at + 1];
        at += 2;

        current_location = cockpit.location.encode(path.slice(0, at));
        current_hash = cockpit.location.encode(path.slice(at));
        current_address = address;

        update_navbar(machine, component);
        update_sidebar(machine, component);
        update_frame(machine, component, current_hash, options);

        recalculate_layout();
    }

    /* Navigation widgets */

    function build_navbar() {
        function links(comp) {
            return $("<li class='dashboard-link'>")
                .attr("data-component", comp.path)
                .append($("<a>").attr("href", "#/" + comp.path).text(comp.label));
        }

        var dashboard = components(local_manifests, "dashboard").map(links);
        $("#content-navbar").append(dashboard);
    }

    function update_navbar(machine, component) {
        $("#machine-avatar").attr("src", machine && machine.avatar ? encodeURI(machine.avatar) : "../shell/images/server-small.png");
        $("#machine-dropdown").toggleClass("active", !!machine);

        var label, title;
        if (machine) {
            label = machine.label;
            title = machine.label;
        } else if (machines.list.length == 1) {
            label = machines.list[0].label;
        } else {
            label = _("Machines");
        }
        $("#machine-link span").text(label);
        $("title").text(title || default_title);

        var color;
        if (machines.list.length == 1 || !machine)
            color = "transparent";
        else
            color = machine.color || "";
        $("#machine-color").css("border-left-color", color);

        $(".dashboard-link").each(function() {
            var el = $(this);
            el.toggleClass("active", el.attr("data-component") === component);
        });
    }

    function update_sidebar(machine, current) {
        var sidebar = $("#sidebar");

        if (!machine || machine.state != "connected" || !machine.manifests) {
            sidebar.hide();
            recalculate_layout();
            return;
        }

        /* TODO: We need to fix races here with quick navigation in succession */
        function links(component) {
            var href = "#";
            if (machine.address != "localhost" || component.path) {
                href += "/@" + machine.address;
                if (component.path)
                    href += "/" + component.path;
            }
            return $("<li>")
                .toggleClass("active", current === component.path)
                .append($("<a>")
                    .attr("href", encodeURI(href))
                    .text(cockpit.gettext(component.label)));
        }

        var menu = components(machine.manifests, "menu").map(links);
        $("#sidebar-menu").empty().append(menu);

        var tools = components(machine.manifests, "tools").map(links);
        $("#sidebar-tools").empty().append(tools);

        sidebar.show();
        recalculate_layout();
    }

    function update_frame(machine, component, hash, options) {
        var title, message, connecting;

        if (machine && machine.state != "connected") {
            $(current_frame).hide();
            current_frame = null;

            connecting = (machine.state == "connecting");
            if (machine.restarting) {
                title = _("The machine is restarting");
                message = "";
            } else if (connecting) {
                title = _("Connecting to the machine");
                message = "";
            } else {
                title = _("Couldn't connect to the machine");
                if (machine.problem == "not-found")
                    message = _("Cannot connect to an unknown machine");
                else
                    message = cockpit.message(machine.problem || machine.state);
            }
            $(".curtains").show();
            $(".curtains .spinner").toggle(connecting || machine.restarting);
            $(".curtains button").toggle(!connecting);
            $(".curtains i").toggle(!connecting && !machine.restarting);
            $(".curtains h1").text(title);
            $(".curtains p").text(message);
            $("#machine-spinner").hide();

            /* Fall through when connecting, and allow frame to load at same time*/
            if (!connecting)
                return;
        } else {
            $(".curtains").hide();
            $("#machine-spinner").toggle(current_frame && !$(current_frame).attr("data-loaded"));
        }

        if (hash == "/")
            hash = "";

        hash = cockpit.location.encode(hash, options);

        var frame = frames.lookup(machine, component, hash);
        if (frame != current_frame) {
            $(current_frame).hide();
            current_frame = frame;
            $(frame).show();
        }

        phantom_checkpoint();
    }

    function update_machines() {
        $("#machine-dropdown .caret")
            .toggle(machines.list.length > 1);

        var machine_link = $("machine-link");
        if (machines.list.length > 1)
            machine_link.attr("data-toggle", "dropdown");
        else
            machine_link.removeAttr("data-toggle");

        var list = $("#machine-dropdown ul");
        var links = machines.list.map(function(machine) {
            var avatar = $("<img>").addClass("machine-avatar")
                        .attr("src", encodeURI(machine.avatar));
            var text = $("<span>").text(machine.label);
            return $("<li role='presentation'>")
                .css("border-left-color", machine.color || "")
                .append($("<a>")
                    .attr("role", "menuitem")
                    .attr("tabindex", "-1")
                    .attr("data-address", machine.address)
                    .append(avatar, text));
            });
        list.empty().append(links);
    }

    function recalculate_layout() {
        var topnav = $('#topnav');
        var sidebar = $('#sidebar');

        var window_height = $(window).height();
        var window_width = $(window).width();
        var topnav_height = topnav.height();
        var sidebar_width = sidebar.is(':visible') ? sidebar.outerWidth() : 0;

        var y = window_height - topnav_height;
        if (current_frame) {
            $(current_frame)
                .height(Math.abs(y))
                .width(Math.abs(window_width - sidebar_width));
        }

        sidebar.height(y);
    }

    $(window).on('resize', function () {
        recalculate_layout();
    });

    function Frames() {
        var self = this;

        /* Lists of frames, by address */
        var iframes = { };

        self.remove = function remove(machine) {
            var address = machine.address;
            if (!address)
                address = "localhost";
            var list = iframes[address];
            if (list) {
                delete iframes[address];
                $.each(list, function(i, frame) {
                    $(frame.contentWindow).off();
                    $(frame).remove();
                });
            }
        };

        self.lookup = function lookup(machine, component, hash) {
            var address;
            if (machine)
                address = machine.address;
            if (!address)
                address = "localhost";

            var list = iframes[address];
            if (!list)
                iframes[address] = list = { };

            var url;

            var frame = list[component];
            if (frame) {
                var src_attr = frame.url + "#" + hash;
                if (frame.getAttribute('src') != src_attr)
                    frame.setAttribute('src', src_attr);
            } else {
                frame = document.createElement("iframe");
                frame.setAttribute("class", "container-frame");
                frame.setAttribute("name", address + "/" + component);
                frame.style.display = "none";

                var parts = component.split("/");

                var base, checksum;
                if (machine)
                    checksum = machine.checksum;
                if (address == "localhost")
                    base = "..";
                else if (checksum)
                    base = "../../" + checksum;
                else
                    base = "../../@" + address;

                frame.url = base + "/" + component + ".html";
                frame.setAttribute('src', frame.url + "#" + hash);

                $("#content").append(frame);
                list[component] = frame;
            }

            return frame;
        };
    }

    function Router() {
        var self = this;

        var unique_id = 0;
        var origin = cockpit.transport.origin;
        var source_by_seed = { };
        var source_by_name = { };

        cockpit.transport.filter(function(message, channel, control) {
            var seed, source, pos;

            /* Only control messages with a channel are forwardable */
            if (control) {
                if (control.channel !== undefined) {
                    for (seed in source_by_seed)
                        source_by_seed[seed].window.postMessage(message, origin);
                }
                return true; /* still deliver locally */

            /* Forward message to relevant frame */
            } else if (channel) {
                pos = channel.indexOf('!');
                if (pos !== -1) {
                    seed = channel.substring(0, pos + 1);
                    source = source_by_seed[seed];
                    if (source) {
                        source.window.postMessage(message, origin);
                        return false; /* Stop delivery */
                    }
                }
                /* Still deliver the message locally */
                return true;
            }
        });

        function perform_jump(child, control) {
            if (!current_frame || current_frame.contentWindow != child)
                return;
            var address = control.host;
            if (address === undefined)
                address = current_address || "localhost";
            var path = [];
            if (address)
                path.push("@" + address);
            if (control.location) {
                var str = control.location;
                if (str.indexOf("/") === 0)
                    str = str.substring(1);
                path.push.apply(path, str.split("/"));
            }
            cockpit.location.go(path);
        }

        function perform_track(child) {
            if (!current_frame || current_frame.contentWindow != child)
                return;
            var hash;
            /* Ignore tracknig for old shell code */
            if (child.name.indexOf("/shell/shell") === -1) {
                hash = child.location.href.split('#')[1] || '';
                if (hash && hash[0] !== '/')
                    hash = '/' + hash;
                if (hash !== current_hash) {
                    current_hash = hash;
                    window.location.hash = "#" + current_location + hash;
                }
            }
        }

        function on_unload(ev) {
            var source = source_by_name[ev.target.defaultView.name];
            if (source)
                unregister(source);
        }

        function on_hashchange(ev) {
            var source = source_by_name[ev.target.name];
            if (source)
                perform_track(source.window);
        }

        function on_load(ev) {
            var source = source_by_name[ev.target.contentWindow.name];
            if (source)
                perform_track(source.window);
            navigate();
        }

        function unregister(source) {
            var child = source.window;
            cockpit.kill(null, child.name);
            var frame = child.frameElement;
            frame.removeEventListener("load", on_load);
            frame.removeAttribute('data-loaded');
            child.removeEventListener("unload", on_unload);
            child.removeEventListener("hashchange", on_hashchange);
            delete source_by_seed[source.channel_seed];
            delete source_by_name[source.name];
        }

        function register(child) {
            var name = child.name;
            var address = (name || "").split("/")[0];
            if (!name || !address) {
                console.warn("invalid child window name", child, name);
                return;
            }

            unique_id += 1;
            var seed = (cockpit.transport.options["channel-seed"] || "undefined:") + unique_id + "!";
            var source = {
                name: name,
                window: child,
                channel_seed: seed,
                default_host: address
            };
            source_by_seed[seed] = source;
            source_by_name[name] = source;

            var frame = child.frameElement;
            frame.addEventListener("load", on_load);
            child.addEventListener("unload", on_unload);
            child.addEventListener("hashchange", on_hashchange);

            /*
             * Setting the "data-loaded" attribute helps the testsuite
             * know when it can switch into the frame and inject its
             * own additions.
             */
            frame.setAttribute('data-loaded', '1');

            perform_track(child);
            phantom_checkpoint();

            return source;
        }

        window.addEventListener("message", function(event) {
            if (event.origin !== origin)
                return;

            var data = event.data;
            if (typeof data !== "string")
                return;

            var child = event.source;
            var source = source_by_name[child.name];

            /* Closing the transport */
            if (data.length === 0) {
                if (source)
                    unregister(source);
                return;
            }

            /* A control message */
            if (data[0] == '\n') {
                var control = JSON.parse(data.substring(1));
                if (control.command === "init") {
                    if (source)
                        unregister(source);
                    source = register(child);
                    var reply = $.extend({ }, cockpit.transport.options,
                        { "host": source.default_host, "channel-seed": source.channel_seed }
                    );
                    child.postMessage("\n" + JSON.stringify(reply), origin);

                } else if (control.command === "jump") {
                    perform_jump(child, control);
                    return;

                } else if (control.command === "hint") {
                    /* watchdog handles current host for now */
                    if (control.hint == "restart" && control.host != cockpit.transport.host) {
                        loader.expect_restart(control.host);
                        perform_jump({ location: "/", host: null });
                    }
                    return;
                } else if (control.command == "oops") {
                    if (setup_oops())
                        oops.show();
                    return;

                /* Only control messages with a channel are forwardable */
                } else if (control.channel === undefined) {
                    return;

                /* Add the child's group to all open channel messages */
                } else if (control.command == "open") {
                    control.group = child.name;
                    data = "\n" + JSON.stringify(control);
                }
            }

            if (!source) {
                console.warn("child frame " + child.name + " sending data without init");
                return;
            }

            /* Everything else gets forwarded */
            cockpit.transport.inject(data);
        }, false);

        /* This tells child frames we are a parent wants to accept messages */
        if (!window.options)
            window.options = { };
        $.extend(window.options, { sink: true, protocol: "cockpit1" });
    }

    function components(manifests, section) {
        var list = [];
        $.each(manifests, function(name, manifest) {
            $.each(manifest[section] || { }, function(ident, info) {
                var path;
                if (info.path) {
                    path = info.path.replace(/\.html$/, "");
                    if (path.indexOf("/") === -1)
                        path = name + "/" + path;
                } else {
                    path = name + "/" + ident;
                }
                list.push({
                    path: path,
                    label: cockpit.gettext(info.label),
                    order: info.order === undefined ? 1000 : info.order
                });
            });
        });

        /* Everything gets sorted by order */
        list.sort(function(a, b) { return a.order - b.order; });
        return list;
    }
});
