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
    "shell/credentials",
    'translated!base1/po',
    "manifests"
], function($, cockpit, machis, credentials, po, local_manifests) {
    "use strict";

    var module = { };

    cockpit.locale(po);
    var _ = cockpit.gettext;

    var default_title = "Cockpit";

    var shell_embedded = window.location.pathname.indexOf(".html") !== -1;

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

        var style, elt = $(id)[0];
        if (elt)
            style = window.getComputedStyle(elt);
        if (!style)
            return;

        var len, content = style.content;
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

    $("#go-logout").on("click", function() {
        cockpit.logout();
    });
    $("#go-account").on("click", function() {
        jump({ host: "localhost", component: "users", hash: "/" + cockpit.user["user"] });
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

    var ready = false;
    var machines = machis.instance();
    var loader = machis.loader(machines);
    var frames = new Frames();
    module.router = new Router();

    /* When the machine list is ready we start processing navigation */
    $(machines)
        .on("ready", function(ev) {
            ready = true;
            $(window).on("popstate", function(ev) {
                navigate(ev.state, true);
            });
            build_navbar();
            navigate();
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
                navigate();
        })
        .on("removed", function(ev, machine) {
            frames.remove(machine);
            update_machines();
        });

    /* When only one machine this operates as a link */
    $("#machine-link").on("click", function(ev) {
        if (machines.list.length == 1) {
            jump({ host: machines.list[0].address, sidebar: true, component: "" });
            return false;
        }
    });

    /* Reconnect button */
    $(".curtains button").on("click", function(ev) {
        navigate(null, true);
    });

    /* Handles an href link as seen below */
    $(document).on("click", "a[href]", function(ev) {
        var a = this;
        if (window.location.host === a.host) {
            jump(a.getAttribute('href'));
            ev.preventDefault();
            phantom_checkpoint();
        }
    });

    /*
     * Navigation is driven by state objects, which are used with pushState()
     * and friends. The state is the canonical navigation location, and not
     * the URL. Only when no state has been pushed or we are arriving from
     * a link, do we parse the state from the URL.
     *
     * Each state object has:
     *   host: a machine host
     *   component: the stripped component to load
     *   hash: the hash to pass to the component
     *   sidebar: set to true to hint that we want a component with a sidebar
     *
     * If state.sidebar is set, and no component has yet been chosen for the
     * given state, then we try to find one that would show a sidebar.
     */

    /* Build an href for use in an <a> */
    function href(state, sidebar) {
        return encode(state, sidebar);
    }

    /* Encode navigate state into a string */
    function encode(state, sidebar) {
        var path = [];
        if (state.host && (sidebar || state.host !== "localhost"))
            path.push("@" + state.host);
        if (state.component)
            path.push.apply(path, state.component.split("/"));
        var string = cockpit.location.encode(path);
        if (state.hash && state.hash !== "/")
            string += "#" + state.hash;
        return string;
    }

    /* Decodes navigate state from a string */
    function decode(string) {
        var state = { version: "v1", hash: "" };
        var pos = string.indexOf("#");
        if (pos !== -1) {
            state.hash = string.substring(pos + 1);
            string = string.substring(0, pos);
        }
        if (string[0] != '/')
            string = "/" + string;
        var path = cockpit.location.decode(string);
        if (path[0] && path[0][0] == "@") {
            state.host = path.shift().substring(1);
            state.sidebar = true;
        } else {
            state.host = "localhost";
        }
        if (path.length && path[path.length - 1] == "index")
            path.pop();
        state.component = path.join("/");
        return state;
    }

    function retrieve() {
        var state = window.history.state;
        if (!state || state.version !== "v1") {
            if (shell_embedded)
                state = decode("/" + window.location.hash);
            else
                state = decode(window.location.pathname + window.location.hash);
        }
        return state;
    }

    /* Jumps to a given navigate state */
    function jump(state, replace) {
        if (typeof (state) === "string")
            state = decode(state);

        var current = retrieve();

        /* Make sure we have the data we need */
        if (!state.host)
            state.host = current.host || "localhost";
        if (!("component" in state))
            state.component = current.component || "";

        var target;
        var history = window.history;

        if (shell_embedded)
            target = window.location;
        else
            target = encode(state);
        if (replace) {
            history.replaceState(state, "", target);
            return false;
        }

        if (state.host !== current.host ||
            state.component !== current.component ||
            state.hash !== current.hash) {
            history.pushState(state, "", target);
            navigate(state, true);
            return true;
        }

        return false;
    }

    /* Handles navigation */
    function navigate(state, reconnect) {
        var machine;

        /* If this is a watchdog problem let the dialog handle it */
        if (watchdog_problem)
            return;

        /* phantomjs has a problem retrieving state, so we allow it to be passed in */
        if (!state)
            state = retrieve();
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
        } else if (reconnect && machine.state !== "connected") {
            loader.connect(state.host);
        }

        var compiled = compile(machine);
        if (machine.manifests && !state.component)
            state.component = choose_component(state, compiled);

        update_navbar(machine, state, compiled);
        update_sidebar(machine, state, compiled);
        update_frame(machine, state, compiled);

        recalculate_layout();

        /* Just replace the state, and URL */
        jump(state, true);
    }

    function choose_component(state, compiled) {
        var item;

        if (machines.list.length <= 1 || shell_embedded)
            state.sidebar = true;

        /* See if we should show a dashboard */
        if (!state.sidebar) {
            item = ordered(compiled.items, "dashboard")[0];
            if (item)
                return item.path;
        }

        /* See if we can find something with currently selected label */
        var label = $("#sidebar li.active a").text();
        if (label) {
            item = search(compiled.items, "label", label);
            if (item)
                return item.path;
        }

        /* Go for the first item */
        item = ordered(compiled.items, "menu")[0];
        if (item)
            return item.path;

        return "system";
    }

    /* Navigation widgets */

    function build_navbar() {
        var navbar = $("#content-navbar");

        function links(component) {
            var a = $("<a>")
                .attr("href", href({ host: "localhost", component: component.path }))
                .text(component.label);
            return $("<li class='dashboard-link'>")
                .attr("data-component", component.path)
                .append(a);
        }

        var machine, items = { };
        if (shell_embedded) {
            navbar.hide();
        } else {
            components(local_manifests, "dashboard", items);
            navbar.append(ordered(items).map(links));
        }
    }

    function update_navbar(machine, state, compiled) {
        $(".dashboard-link").each(function() {
            var el = $(this);
            el.toggleClass("active", el.attr("data-component") === state.component);
        });

        var item = compiled.items[state.component];
        if (item && item.section == "dashboard") {
            delete state.sidebar;
            machine = null;
        }

        $("#machine-avatar").attr("src", machine && machine.avatar ? encodeURI(machine.avatar) :
                                            "../shell/images/server-small.png");

        var label;
        if (machine) {
            label = machine.label;
        } else if (machines.list.length == 1) {
            label = machines.list[0].label;
        } else {
            label = _("Machines");
        }
        $("#machine-link span").text(label);

        var color;
        if (machines.list.length == 1 || !machine)
            color = "transparent";
        else
            color = machine.color || "";
        $("#machine-color").css("border-left-color", color);

        $("#machine-dropdown").toggleClass("active", !!machine);

        /* Decide when to show the sidebar */
        var sidebar = $("#sidebar");

        if (machine && machine.state == "connected")
            sidebar.show();
        else
            sidebar.hide();
    }

    function update_sidebar(machine, state, compiled) {
        function links(component) {
            return $("<li>")
                .toggleClass("active", state.component === component.path)
                .append($("<a>")
                    .attr("href", href({ host: machine.address, component: component.path }))
                    .text(component.label));
        }

        var menu = ordered(compiled.items, "menu").map(links);
        $("#sidebar-menu").empty().append(menu);

        var tools = ordered(compiled.items, "tools").map(links);
        $("#sidebar-tools").empty().append(tools);
    }

    function update_title(label, machine) {
        if (label)
            label += " - ";
        else
            label = "";
        var suffix = default_title;
        if (machine && machine.label)
            suffix = machine.label;
        document.title = label + suffix;
    }

    function update_frame(machine, state, compiled) {
        var title, message, connecting, restarting;

        if (machine.state != "connected") {
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

            restarting = !!machine.restarting;
            $(".curtains").show();
            $(".curtains .spinner").toggle(connecting || restarting);
            $(".curtains button").toggle(!connecting);
            $(".curtains i").toggle(!connecting && !restarting);
            $(".curtains h1").text(title);
            $(".curtains p").text(message);
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
            frame = frames.lookup(machine, component, hash);
        if (frame != current_frame) {
            $(current_frame).css('display', 'none');
            current_frame = frame;
            $(frame).css('display', 'block');
        }

        var label, item;
        if (machine.state == "connected") {
            $(".curtains").hide();
            $("#machine-spinner").toggle(frame && !$(frame).attr("data-ready"));
            item = compiled.items[state.component];
            label = item ? item.label : "";
            update_title(label, machine);
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
                    .attr("href", href({ host: machine.address }, true))
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

        /* Lists of frames, by host */
        var iframes = { };

        self.remove = function remove(machine) {
            var host = machine.address;
            if (!host)
                host = "localhost";
            var list = iframes[host];
            if (list) {
                delete iframes[host];
                $.each(list, function(i, frame) {
                    $(frame.contentWindow).off();
                    $(frame).remove();
                });
            }
        };

        function frame_ready(frame, count) {
            var ready = false;

            window.clearTimeout(frame.timer);
            frame.timer = null;

            try {
                ready = $("body", frame.contentWindow.document).is(":visible");
            } catch(ex) {
                ready = true;
            }

            if (!count)
                count = 0;
            count += 1;
            if (count > 50)
                ready = true;

            if (ready) {
                if (frame.getAttribute("data-ready") != "1") {
                    frame.setAttribute("data-ready", "1");
                    if (count > 0)
                        navigate();
                }
            } else {
                frame.timer = window.setTimeout(function() {
                    frame_ready(frame, count + 1);
                }, 100);
            }
        }

        self.lookup = function lookup(machine, component, hash) {
            var host;
            if (machine)
                host = machine.address;
            if (!host)
                host = "localhost";

            var list = iframes[host];
            if (!list)
                iframes[host] = list = { };

            var name = "cockpit1:" + host + "/" + component;
            var frame = list[component];
            var wind = window.frames[name];

            /* A preloaded frame */
            if (!frame && wind) {
                frame = wind.frameElement;
                frame.url = frame.getAttribute('src').split("#")[0];
                list[component] = frame;

            /* Need to create a new frame */
            } else if (!frame) {
                frame = document.createElement("iframe");
                frame.setAttribute("class", "container-frame");
                frame.setAttribute("name", name);
                frame.style.display = "none";

                var parts = component.split("/");

                var base, checksum;
                if (machine)
                    checksum = machine.checksum;
                if (host === "localhost")
                    base = "..";
                else if (checksum)
                    base = "../../" + checksum;
                else
                    base = "../../@" + host;

                frame.url = base + "/" + component;
                if (component.indexOf("/") === -1)
                    frame.url += "/index";
                frame.url += ".html";

                $("#content").append(frame);
                list[component] = frame;
            }

            if (!hash)
                hash = "/";
            var src = frame.url + "#" + hash;
            if (frame.getAttribute('src') != src)
                frame.setAttribute('src', src);

            frame_ready(frame);
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
            if (child !== window) {
                if (!current_frame || current_frame.contentWindow != child)
                    return;
            }
            var str = control.location || "";
            if (str[0] != "/")
                str = "/" + str;
            if (control.host)
                str = "/@" + encodeURIComponent(control.host) + str;
            jump(str);
        }

        function perform_track(child) {
            var hash;

            /* Note that we ignore tracknig for old shell code */
            if (current_frame && current_frame.contentWindow === child &&
                child.name && child.name.indexOf("/shell/shell") === -1) {
                hash = child.location.hash;
                if (hash.indexOf("#") === 0)
                    hash = hash.substring(1);
                if (hash === "/")
                    hash = "";
                jump({ hash: hash });
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
        }

        function unregister(source) {
            var child = source.window;
            cockpit.kill(null, child.name);
            var frame = child.frameElement;
            if (frame)
                frame.removeEventListener("load", on_load);
            child.removeEventListener("unload", on_unload);
            child.removeEventListener("hashchange", on_hashchange);
            delete source_by_seed[source.channel_seed];
            delete source_by_name[source.name];
        }

        function register(child) {
            var host, name = child.name || "";
            if (name.indexOf("cockpit1:") === 0)
                host = name.substring(9).split("/")[0];
            if (!name || !host) {
                console.warn("invalid child window name", child, name);
                return;
            }

            unique_id += 1;
            var seed = (cockpit.transport.options["channel-seed"] || "undefined:") + unique_id + "!";
            var source = {
                name: name,
                window: child,
                channel_seed: seed,
                default_host: host
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

            navigate();
            return source;
        }

        function message_handler(event) {
            if (event.origin !== origin)
                return;

            var data = event.data;
            var child = event.source;
            if (!child || typeof data !== "string")
                return;

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
                    if (source) {
                        var reply = $.extend({ }, cockpit.transport.options,
                            { command: "init", "host": source.default_host, "channel-seed": source.channel_seed }
                        );
                        child.postMessage("\n" + JSON.stringify(reply), origin);
                    }

                } else if (control.command === "jump") {
                    perform_jump(child, control);
                    return;

                } else if (control.command === "hint") {
                    /* watchdog handles current host for now */
                    if (control.hint == "restart" && control.host != cockpit.transport.host) {
                        loader.expect_restart(control.host);
                        jump({ host: "localhost", component: "" });
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
        }


        self.start = function start(messages) {
            window.addEventListener("message", message_handler, false);
            for (var i = 0, len = messages.length; i < len; i++)
                message_handler(messages[i]);
        };
    }

    function components(manifests, section, items) {
        $.each(manifests || { }, function(name, manifest) {
            $.each(manifest[section] || { }, function(prop, info) {
                var item = {
                    section: section,
                    label: cockpit.gettext(info.label) || prop,
                    order: info.order === undefined ? 1000 : info.order
                };
                if (info.path)
                    item.path = info.path.replace(/\.html$/, "");
                else
                    item.path = name + "/" + prop;
                if (item.path.indexOf("/") === -1)
                    item.path = name + "/" + item.path;
                if (item.path.slice(-6) == "/index")
                    item.path = item.path.slice(0, -6);
                items[item.path] = item;
            });
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
        var compiled = {
            items: { },
            compat: compatibility(machine)
        };
        components(machine.manifests, "tools", compiled.items);
        components(machine.manifests, "dashboard", compiled.items);
        components(machine.manifests, "menu", compiled.items);
        return compiled;
    }

    function ordered(object, section) {
        var x, list = [];
        if (!object)
            object = { };
        for (x in object) {
            if (!section || object[x].section === section)
                list.push(object[x]);
        }
        list.sort(function(a, b) { return a.order - b.order; });
        return list;
    }

    function search(object, prop, value) {
        var x;
        for (x in object) {
            if (object[x][prop] === value)
                return object[x];
        }
    }

    return module;
});
