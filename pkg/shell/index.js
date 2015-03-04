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

require([
    "jquery",
    "latest/cockpit",
    'latest/po',
    "manifests"
], function($, cockpit, po, manifests) {
    cockpit.locale(po);
    var _ = cockpit.gettext;

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
        cockpit.location.go([ "@localhost", "users", "local" ], { id: cockpit.user["user"] });
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
    var manifest = manifests["shell"] || { };
    $.each(manifest.linguas, function(code, name) {
        var el = $("<option>").text(name).val(code);
        if (code == cockpit.language)
            el.attr("selected", "true");
        $("#display-language-list").append(el);
    });

    $("#display-language-select-button").on("click", function(event) {
        var code_to_select = $("#display-language-list").val();
        document.cookie = "cockpitlang=" + code_to_select;
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
        $("#about-build-info").text(cockpit.info.build);
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
        window.location.reload(false);
    });

    $('#disconnected-logout').on("click", function() {
        cockpit.logout();
        phantom_checkpoint();
    });

    var watchdog = cockpit.channel({ "payload": "null" });
    $(watchdog).on("close", function(event, options) {
        console.warn("transport closed: " + options.problem);
        watchdog_problem = options.problem;
        $('.modal[role="dialog"]').modal('hide');
        $('#disconnected-dialog').modal('show');
        phantom_checkpoint();
    });

    /* Navigation */

    var ready = false;
    var current_frame = null;
    var current_location;
    var current_address;

    var machines = new Machines();
    var frames = new Frames();
    var router = new Router();
    var components = new Components();

    function maybe_ready() {
        if (ready)
            return;
        if (!machines.loaded || !components.loaded)
            return;
        ready = true;
        $("nav").show();
        phantom_checkpoint();
    }

    /* When the machine list is ready we start processing navigation */
    $(machines)
        .on("ready", function(ev) {
            machines.loaded = true;
            $(cockpit).on("locationchanged", navigate);
            navigate();
            maybe_ready();
        })
        .on("added changed", function(ev, machine) {
            update_machines();
            if (machines.loaded)
                navigate();
            maybe_ready();
        })
        .on("removed", function(ev, machine) {
            frames.remove(machine);
            update_machines();
        });

    $(frames)
        .on("added", function(ev, frame, address) {
            router.register(frame.contentWindow, address);

            /*
             * Setting the "data-loaded" attribute helps the testsuite
             * to know when it can switch into the frame and inject
             * its own additions.
             */

            $(frame).on("load", function() {
                $(this).attr('data-loaded', true);
                phantom_checkpoint();
                $(this.contentWindow).on('hashchange', function () {
                    if (current_frame && !frame.no_hash_tracking && current_frame.contentWindow === this) {
                        var hash = this.location.href.split('#')[1] || '';
                        window.location.hash = "#" + current_location + hash;
                    }
                });
            });
        })
        .off("removed", function(ev, frame) {
            router.unregister(frame.contentWindow);
            $(frame.contentWindow).off();
            $(frame).off();
            phantom_checkpoint();
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

    function navigate() {
        var path = cockpit.location.path;
        var options = cockpit.location.options;

        var address = null;
        var component = null;
        var machine = null;

        var at = 0;
        if (path.length === at) {

            /*
             * When more than one machine, we show dashboard by default
             * otherwise we  show the server
             */
            if (machines.list.length <= 1)
                address = "localhost";

        } else if (path[at][0] == '@') {
            address = path[at].substring(1);
            at++;
        }

        if (address) {

            /* If the machine is not available, then redirect to dashboard */
            machine = machines.lookup(address);
            if (!machine) {
                cockpit.location.go("/dashboard/list");
                return;
            }

            /* The default is to show the server */
            if (path.length === at)
                component = "system/host";
        } else {

            /* The default is to show main dashboard */
            if (path.length === at)
                component = "dashboard/list";
        }

        if (!component) {
            if (path.length == at + 1) {
                component = "invalid/invalid";
            } else {
                component = path[at] + "/" + path[at + 1];
                at += 2;
            }
        }

        current_location = "/" + path.slice(0, at).join("/");
        current_address = address;

        update_navbar(machine, component);
        update_sidebar(machine, component);
        update_frame(machine, component, "/" + path.slice(at).join("/"), options);

        recalculate_layout();
    }

    /* Navigation widgets */

    function update_navbar(machine, component) {
        $("#machine-avatar").attr("src", machine ? encodeURI(machine.avatar) : "images/server-small.png");
        $("#machine-dropdown").toggleClass("active", !!machine);

        var label;
        if (machine)
            label = machine.label;
        else if (machines.list.length == 1)
            label = machines.list[0].label;
        else
            label = _("Machines");
        $("#machine-link span").text(label);

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

        if (!machine) {
            sidebar.hide();
            components.loaded = true;
            maybe_ready();
            recalculate_layout();
            return;
        }

        /* TODO: We need to fix races here with quick navigation in succession */

        components.lookup(machine, function(data) {
            components.loaded = true;
            var links = data.map(function(component) {
                var href = "#";
                if (machine.address != "localhost" || component.path) {
                    href += "/@" + machine.address;
                    if (component.path)
                        href += "/" + component.path;
                }
                return $("<a>")
                    .attr("href", encodeURI(href))
                    .addClass("list-group-item")
                    .toggleClass("active", current === component.path)
                    .text(cockpit.gettext(component.label));
            });
            sidebar.empty().append(links);

            maybe_ready();
            sidebar.show();
            recalculate_layout();
        });
    }

    function update_frame(machine, component, hash, options) {
        var dashboard = false;

        /* TODO: Move away from legacy pages */
        if (hash == "/")
            hash = "";

        if (machine) {
            if (component == "system/host") {
                component = "shell/shell";
                hash = "/server" + hash;
            } else if (component == "system/init") {
                component = "shell/shell";
                if (options && options.s)
                    hash = "/service";
                else
                    hash = "/services";
            } else if (component == "docker/containers") {
                component = "shell/shell";
                hash = "/containers" + hash;
            } else if (component == "network/interfaces") {
                component = "shell/shell";
                hash = "/networking" + hash;
            } else if (component == "storage/devices") {
                component = "shell/shell";
                hash = "/storage" + hash;
            } else if (component == "users/local") {
                component = "shell/shell";
                if (options && options.id)
                    hash = "/account";
                else
                    hash = "/accounts";
            }
        } else {
            dashboard = true;
            if (component == "dashboard/list") {
                component = "shell/shell";
                hash = "/";
            }
        }

        hash = cockpit.location.encode(hash, options);

        var frame = frames.lookup(machine, component, hash);
        if (component == "shell/shell")
            frame.no_hash_tracking = true;
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
        var body = $(document.body);

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
            var list = iframes[machines.address];
            if (list) {
                delete iframes[address];
                $.each(list, function(i, frame) {
                    $(frame.contentWindow).off();
                    $(self).triggerHandler("removed", frame);
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
                frame.setAttribute('src', frame.url + "#" + hash);

            } else {
                frame = document.createElement("iframe");
                frame.setAttribute("class", "container-frame");
                frame.setAttribute("name", address + "/" + component);
                frame.style.display = "none";

                var parts = component.split("/");

                var base;
                if (address == "localhost")
                    base = "..";
                else if (machine.checksum)
                    base = "../../$" + machine.checksum;
                else
                    base = "../../@" + machine.address;

                frame.url = base + "/" + component + ".html";
                frame.setAttribute('src', frame.url + "#" + hash);

                $("#content").append(frame);
                list[component] = frame;
                $(self).triggerHandler("added", [ frame, address ]);
            }

            return frame;
        };
    }

    function Router() {
        var self = this;

        var unique_id = 0;
        var origin = cockpit.transport.origin;
        var frame_peers_by_seed = { };
        var frame_peers_by_name = { };

        cockpit.transport.filter(function(message, channel, control) {

            /* Only control messages with a channel are forwardable */
            if (control) {
                if (control.channel !== undefined) {
                    $.each(frame_peers_by_seed, function(seed, peer) {
                        if (peer.initialized)
                            peer.window.postMessage(message, origin);
                    });
                }
                return true; /* still deliver locally */

            /* Forward message to relevant frame */
            } else if (channel) {
                var pos = channel.indexOf('!');
                if (pos !== -1) {
                    var seed = channel.substring(0, pos + 1);
                    var peer = frame_peers_by_seed[seed];
                    if (peer && peer.initialized) {
                        peer.window.postMessage(message, origin);
                        return false; /* Stop delivery */
                    }
                }
                /* Still deliver the message locally */
                return true;
            }
        });

        function perform_jump(control) {
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

        window.addEventListener("message", function(event) {
            if (event.origin !== origin)
                return;

            var data = event.data;
            if (typeof data !== "string")
                return;

            var frame = event.source;
            var peer = frame_peers_by_name[frame.name];
            if (!peer || peer.window != frame)
                return;

            /* Closing the transport */
            if (data.length === 0) {
                peer.initialized = false;
                return;
            }

            /* A control message */
            if (data[0] == '\n') {
                var control = JSON.parse(data.substring(1));
                if (control.command === "init") {
                    peer.initialized = true;
                    var reply = $.extend({ }, cockpit.transport.options,
                        { "default-host": peer.default_host, "channel-seed": peer.channel_seed }
                    );
                    frame.postMessage("\n" + JSON.stringify(reply), origin);

                } else if (control.command === "jump") {
                    if (current_frame && current_frame.contentWindow == peer.window)
                        perform_jump(control);
                    return;

                } else if (control.command == "oops") {
                    if (setup_oops())
                        oops.show();
                    return;

                /* Only control messages with a channel are forwardable */
                } else if (control.channel === undefined) {
                    return;
                }
            }

            if (!peer.initialized) {
                console.warn("child frame " + frame.name + " sending data without init");
                return;
            }

            /* Everything else gets forwarded */
            cockpit.transport.inject(data);
        }, false);

        /* This tells child frames we are a parent wants to accept messages */
        if (!window.options)
            window.options = { };
        $.extend(window.options, { sink: true, protocol: "cockpit1" });

        self.register = function register(child, address) {
            if (!child.name) {
                console.warn("invalid child window", child);
                return;
            }

            unique_id += 1;
            var seed = (cockpit.transport.options["channel-seed"] || "undefined:") + unique_id + "!";
            var peer = {
                window: child,
                channel_seed: seed,
                default_host: address,
                initialized: false
            };
            frame_peers_by_seed[seed] = peer;
            frame_peers_by_name[child.name] = peer;
        };

        self.unregister = function unregister(child) {
            var peer = frame_peers_by_name[child.name];
            if (!peer) {
                console.warn("invalid child window", child);
                return;
            }

            delete frame_peers_by_seed[peer.channel_seed];
            delete frame_peers_by_name[child.name];
        };
    }

    function Machines() {
        var self = this;
        var flat = null;

        /* TODO: This should be migrated away from cockpitd */

        var client = cockpit.dbus("com.redhat.Cockpit", { bus: "session", track: true });
        var proxies = client.proxies("com.redhat.Cockpit.Machine", "/com/redhat/Cockpit/Machines");

        function hostname_label(name) {
            if (!name || name == "localhost" || name == "localhost.localdomain")
                return window.location.hostname;
            return name;
        }

        var map = { };
        $(proxies).on('added changed', function(ev, proxy) {
            var machine = map[proxy.Address];
            if (!machine)
                machine = { };
            machine.address = proxy.Address;
            machine.label = hostname_label(proxy.Name || proxy.Address);
            machine.color = proxy.Color;
            machine.avatar = proxy.Avatar || "images/server-small.png";
            machine.tags = proxy.Tags || [];
            map[proxy.Address] = machine;
            flat = null;
            $(self).triggerHandler(ev.type, machine);
        });

        $(proxies).on('removed', function(ev, proxy) {
            var machine = map[proxy.Address];
            delete map[proxy.Address];
            flat = null;
            $(self).triggerHandler('removed', machine);
        });

        proxies.wait(function() {
            flat = null;
            $(self).triggerHandler('ready');
        });

        Object.defineProperty(self, "list", {
            enumerable: true,
            get: function get() {
                if (!flat) {
                    flat = [];
                    for (var key in map) {
                        if ($.inArray("dashboard", map[key].tags) !== -1)
                            flat.push(map[key]);
                    }
                    flat.sort(function(m1, m2) {
                        return m2.label.localeCompare(m2.label);
                    });
                }
                return flat;
            }
        });

        self.lookup = function lookup(address) {
            return map[address || "localhost"] || null;
        };

        self.close = function close() {
            if (proxies)
                $(proxies).off();
            if (client)
                client.close();
        };
    }

    function Components() {
        var self = this;
        var requests = [ ];

        function build(list, pkgs) {
            pkgs.sort(function(a, b) {
                return a.name == b.name ? 0 : a.name < b.name ? -1 : 1;
            });

            /* TODO: The manifest format should describe components more completely */

            var seen = { };
            $.each(pkgs, function(i, pkg) {
                var tools = pkg.manifest.tools;
                if (!tools)
                    return;
                $.each(tools, function(ident, info) {
                    var file = info.path;
                    if (!file)
                        file = ident;
                    file = file.replace(/\.html$/, "");
                    list.push({
                        path: pkg.id[0] + "/" + file,
                        label: cockpit.gettext(info.label)
                    });
                });
            });
        }

        self.lookup = function lookup(machine, callback) {
            if (machine.components) {
                callback(machine.components);
                return;
            }

            var list = [];

            /* TODO: We should remove the hard coded settings here */

            list.push.apply(list, [
                {
                    path: "system/host",
                    label: _("System"),
                },
                {
                    path: "system/init",
                    label: _("Services"),
                },
                {
                    path: "docker/containers",
                    label: _("Containers"),
                },
                {
                    path: "server/log",
                    label: _("Journal"),
                },
                {
                    path: "network/interfaces",
                    label: _("Networking"),
                },
                {
                    path: "storage/devices",
                    label: _("Storage"),
                },
                {
                    path: "users/local",
                    label: _("Administrator Accounts"),
                }
            ]);

            var url;
            if (machine.address == "localhost")
                url = "../manifests.json";
            else if (machine.checksum)
                url = "../../$" + machine.checksum + "/manifests.json";
            else
                url = "../../@" + machine.address + "/manifests.json";

            var req = $.ajax({ url: url, dataType: "json", cache: true})
                .done(function(pkgs) {
                    build(list, pkgs);
                    var etag = req.getResponseHeader("ETag");
                    if (etag)
                        machine.checksum = etag;
                })
                .fail(function(pkgs) {
                    console.warn("failed to load manifests from " + machine.address);
                })
                .always(function() {
                    req.pending = false;
                    machine.components = list;
                    callback(list);
                });

            req.pending = true;
            requests.push(req);
        };

        self.close = function close() {
            $.each(requests, function(i, req) {
                if (req.pending)
                    req.abort();
                req.pending = false;
            });
        };
    }
});
