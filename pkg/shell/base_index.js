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

(function() {
    "use strict";

    var $ = require("jquery");
    var cockpit = require("cockpit");

    var shell_embedded = window.location.pathname.indexOf(".html") !== -1;
    var _ = cockpit.gettext;

    function Frames(index) {
        var self = this;

        /* Lists of frames, by host */
        var iframes = { };

        function remove_frame(frame) {
            $(frame.contentWindow).off();
            $(frame).remove();
        }
        self.remove = function remove(machine) {
            var address = machine.address;
            if (!address)
                address = "localhost";
            var list = iframes[address];
            if (list) {
                delete iframes[address];
                $.each(list, function(i, frame) {
                    remove_frame(frame);
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
                        index.navigate();
                }
            } else {
                frame.timer = window.setTimeout(function() {
                    frame_ready(frame, count + 1);
                }, 100);
            }
        }

        self.lookup_component_hash = function(machine, component) {
            var address, list, frame, src;

            if (machine)
                address = machine.address;

            if (!address)
                address = "localhost";

            list = iframes[address];
            if (list)
                frame = list[component];

            if (frame) {
                src = frame.getAttribute('src');
                if (src)
                    return src.split("#")[1];
            }
        };

        self.lookup = function lookup(machine, component, hash) {
            var host;
            var address;
            var new_frame = false;

            if (machine) {
                host = machine.connection_string;
                address = machine.address;
            }

            if (!host)
                host = "localhost";

            if (!address)
                address = host;

            var list = iframes[address];
            if (!list)
                iframes[address] = list = { };

            var name = "cockpit1:" + host + "/" + component;
            var frame = list[component];
            if (frame && frame.getAttribute("name") != name) {
                remove_frame(frame);
                frame = null;
            }

            var wind, src;

            /* A preloaded frame */
            if (!frame) {
                wind = window.frames[name];
                if (wind)
                    frame = wind.frameElement;
                if (frame) {
                    src = frame.getAttribute('src');
                    frame.url = src.split("#")[0];
                    list[component] = frame;
                }
            }

            /* Need to create a new frame */
            if (!frame) {
                new_frame = true;
                frame = document.createElement("iframe");
                frame.setAttribute("class", "container-frame");
                frame.setAttribute("name", name);
                frame.style.display = "none";

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
            }

            if (!hash)
                hash = "/";
            src = frame.url + "#" + hash;
            if (frame.getAttribute('src') != src)
                frame.setAttribute('src', src);

            /* Store frame only when fully setup */
            if (new_frame) {
                list[component] = frame;
                $("#content").append(frame);
            }
            frame_ready(frame);
            return frame;
        };
    }

    function Router(index) {
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
                } else if (control.command == "hint") {
                    if (control.credential)
                        index.authorize_changed(control.credential);
                }

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
            }

            /* Still deliver the message locally */
            return true;
        }, false);

        function perform_jump(child, control) {
            var current_frame = index.current_frame();
            if (child !== window) {
                if (!current_frame || current_frame.contentWindow != child)
                    return;
            }
            var str = control.location || "";
            if (str[0] != "/")
                str = "/" + str;
            if (control.host)
                str = "/@" + encodeURIComponent(control.host) + str;
            index.jump(str);
        }

        function perform_track(child) {
            var hash;
            var current_frame = index.current_frame();
            /* Note that we ignore tracknig for old shell code */
            if (current_frame && current_frame.contentWindow === child &&
                child.name && child.name.indexOf("/shell/shell") === -1) {
                hash = child.location.hash;
                if (hash.indexOf("#") === 0)
                    hash = hash.substring(1);
                if (hash === "/")
                    hash = "";
                index.jump({ hash: hash });
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
                default_host: host,
                inited: false,
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

            index.navigate();
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
            var control;

            /* Closing the transport */
            if (data.length === 0) {
                if (source)
                    unregister(source);
                return;
            }

            /* A control message */
            if (data[0] == '\n') {
                control = JSON.parse(data.substring(1));
                if (control.command === "init") {
                    if (source)
                        unregister(source);
                    source = register(child);
                    if (source) {
                        var reply = $.extend({ }, cockpit.transport.options,
                            { command: "init", "host": source.default_host, "channel-seed": source.channel_seed }
                        );
                        child.postMessage("\n" + JSON.stringify(reply), origin);
                        source.inited = true;

                        /* If this new frame is not the current one, tell it */
                        if (child.frameElement != index.current_frame())
                            self.hint(child.frameElement.contentWindow, { "hidden": true });
                    }

                } else if (control.command === "jump") {
                    perform_jump(child, control);
                    return;

                } else if (control.command === "hint") {
                    if (control.hint == "restart") {
                        /* watchdog handles current host for now */
                        if (control.host != cockpit.transport.host)
                            index.expect_restart(control.host);
                    } else
                        cockpit.hint(control.hint, control);
                    return;
                } else if (control.command == "oops") {
                    index.show_oops();
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
            cockpit.transport.inject(data, true);
        }


        self.start = function start(messages) {
            window.addEventListener("message", message_handler, false);
            for (var i = 0, len = messages.length; i < len; i++)
                message_handler(messages[i]);
        };

        self.hint = function hint(child, data) {
            var message, source = source_by_name[child.name];
            if (source && source.inited) {
                data.command = "hint";
                message = "\n" + JSON.stringify(data);
                source.window.postMessage(message, origin);
            }
        };
    }

    /*
     * New instances of Index must be created by new_index_from_proto
     * and the caller must include a navigation function in the given
     * prototype. That function will be called by by Frames and
     * Router to actually perform any navigation action.
     *
     * As a convenience, common menu items can be setup by adding the
     * selector to be used to hook them up. The accepted selectors
     * are.
     * oops_sel, logout_sel, language_sel, brand_sel, about_sel,
     * user_sel, account_sel
     *
     * Emits "disconnect" and "expect_restart" signals, that should be
     * handled by the caller.
     */
    function Index() {
        var self = this;
        var current_frame;

        if (typeof self.navigate !== "function")
            throw "Index requires a prototype with a navigate function";

        self.frames = new Frames(self);
        self.router = new Router(self);

        /* Watchdog for disconnect */
        var watchdog = cockpit.channel({ "payload": "null" });
        $(watchdog).on("close", function(event, options) {
            var watchdog_problem = options.problem || "disconnected";
            console.warn("transport closed: " + watchdog_problem);
            $(self).triggerHandler("disconnect", watchdog_problem);
        });

        /* Handles an href link as seen below */
        $(document).on("click", "a[href]", function(ev) {
            var a = this;
            if (window.location.host === a.host) {
                self.jump(a.getAttribute('href'));
                ev.preventDefault();
                phantom_checkpoint();
            }
        });

        if (window.navigator.userAgent.indexOf("PhantomJS") == -1) {
            var old_onerror = window.onerror;
            window.onerror = function cockpit_error_handler(msg, url, line) {
                self.show_oops();
                phantom_checkpoint();
                if (old_onerror)
                    return old_onerror(msg, url, line);
                return false;
            };
        }

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

        /* Encode navigate state into a string
         * If with_root is true the configured
         * url root will be added to the generated
         * url. with_root should be used when
         * navigating to a new url or updating
         * history, but is not needed when simply
         * generating a string for a link.
         */
        function encode(state, sidebar, with_root) {
            var path = [];
            if (state.host && (sidebar || state.host !== "localhost"))
                path.push("@" + state.host);
            if (state.component)
                path.push.apply(path, state.component.split("/"));
            var string = cockpit.location.encode(path, null, with_root);
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

        function build_navbar() {
            var navbar = $("#content-navbar");

            function links(component) {
                var a = $("<a>")
                    .attr("href", self.href({ host: "localhost", component: component.path }))
                    .text(component.label);
                return $("<li class='dashboard-link'>")
                    .attr("data-component", component.path)
                    .append(a);
            }

            if (shell_embedded) {
                navbar.hide();
            } else {
                var local_compiled = new CompiledComponants();
                local_compiled.load(cockpit.manifests, "dashboard");
                navbar.append(local_compiled.ordered("dashboard").map(links));
            }
        }

        self.recalculate_layout = function() {
            var topnav = $('#topnav');
            var sidebar = $('#sidebar');
            var content = $('#content');

            var window_height = $(window).height();
            var topnav_height = topnav.height();

            var y = window_height - topnav_height;
            $(current_frame).height(Math.floor(y));
            sidebar.height(y);

            var sidebar_width = sidebar.is(':visible') ? sidebar.outerWidth() : 0;
            content.css("margin-left", sidebar_width + "px");
        };

        self.retrieve_state = function() {
            var state = window.history.state;
            if (!state || state.version !== "v1") {
                if (shell_embedded)
                    state = decode("/" + window.location.hash);
                else
                    state = decode(window.location.pathname + window.location.hash);
            }
            return state;
        };

        /* Jumps to a given navigate state */
        self.jump = function (state, replace) {
            if (typeof (state) === "string")
                state = decode(state);

            var current = self.retrieve_state();

            /* Make sure we have the data we need */
            if (!state.host)
                state.host = current.host || "localhost";
            if (!("component" in state))
                state.component = current.component || "";

            var target;
            var history = window.history;
            var frame_change = (state.host !== current.host ||
                                state.component !== current.component);

            if (frame_change && !state.hash) {
                state.hash = self.frames.lookup_component_hash(state.host,
                                                               state.component);
            }

            if (shell_embedded)
                target = window.location;
            else
                target = encode(state, null, true);

            if (replace) {
                history.replaceState(state, "", target);
                return false;
            }


            if (frame_change || state.hash !== current.hash) {
                history.pushState(state, "", target);
                self.navigate(state, true);
                return true;
            }

            return false;
        };

        /* Build an href for use in an <a> */
        self.href = function (state, sidebar) {
            return encode(state, sidebar);
        };

        self.show_oops = function () {
            if (self.oops_sel)
                $(self.oops_sel).show();
        };

        self.current_frame = function (frame) {
            if (frame !== undefined) {
                if (current_frame !== frame) {
                    if (current_frame && current_frame.contentWindow)
                        self.router.hint(current_frame.contentWindow, { "hidden": true });
                    if (frame && frame.contentWindow)
                        self.router.hint(frame.contentWindow, { "hidden": false });
                }
                current_frame = frame;
            }
            return current_frame;
        };

        self.start = function() {
            /* window.messages is initialized in shell/bundle.js */
            var messages = window.messages;
            if (messages)
                messages.cancel();
            self.router.start(messages || []);
        };

        self.ready = function () {
            $(window).on("popstate", function(ev) {
                self.navigate(ev.state, true);
            });

            $(window).on('resize', function () {
                self.recalculate_layout();
            });

            build_navbar();
            self.navigate();
            cockpit.translate();
            $("body").show();
        };

        self.expect_restart = function (host) {
            $(self).triggerHandler("expect_restart", host);
        };

        self.authorize_changed = function(value) {
            $(self.credential_sel).toggle(value != "clear");
        };

        /* Menu items */
        /* The oops bar */
        function setup_oops(id) {
            var oops = $(id);
            if (!oops)
                return;
            oops.children("a").on("click", function() {
                $("#error-popup-title").text(_("Unexpected error"));
                var details = _("Cockpit had an unexpected internal error. <br/><br/>You can try restarting Cockpit by pressing refresh in your browser. The javascript console contains details about this error (<b>Ctrl-Shift-J</b> in most browsers).");
                $("#error-popup-message").html(details);
                $('#error-popup').modal('show');
            });
        }

        /* Branding */
        function setup_brand(id, default_title) {
            var os_release = JSON.parse(window.localStorage['os-release'] || "{}");

            var style, elt = $(id)[0];
            if (elt)
                style = window.getComputedStyle(elt);
            if (!style)
                return;

            var len, content = style.content;
            if (content && content != "none" && content != "normal") {
                len = content.length;
                if ((content[0] === '"' || content[0] === '\'') &&
                    len > 2 && content[len - 1] === content[0])
                    content = content.substr(1, len - 2);
                elt.innerHTML = cockpit.format(content, os_release) || default_title;
                return $(elt).text();
            }
        }

        /* Logout link */
        function setup_logout(id) {
            $(id).on("click", function() {
                cockpit.logout();
            });
        }

        /* Display language dialog */
        function setup_language(id) {
            /*
             * Note that we don't go ahead and load all the po files in order
             * to produce this list. Perhaps we would include it somewhere in a
             * separate automatically generated file. Need to see.
             */
            var manifest = cockpit.manifests["shell"] || { };
            $(".display-language-menu").toggle(!!manifest.locales);
            var language = document.cookie.replace(/(?:(?:^|.*;\s*)CockpitLang\s*\=\s*([^;]*).*$)|^.*$/, "$1");
            if (!language)
                language = "en-us";
            $.each(manifest.locales || { }, function(code, name) {
                var el = $("<option>").text(name).val(code);
                if (code == language)
                    el.attr("selected", "true");
                $("#display-language-list").append(el);
            });

            $("#display-language-select-button").on("click", function(event) {
                var code_to_select = $("#display-language-list").val();
                var cookie = "CockpitLang=" + encodeURIComponent(code_to_select) +
                             "; path=/; expires=Sun, 16 Jul 3567 06:23:41 GMT";
                document.cookie = cookie;
                window.localStorage.setItem("cockpit.lang", code_to_select);
                window.location.reload(true);
                return false;
            });

            $(id).on("shown.bs.modal", function() {
                $("display-language-list").focus();
                phantom_checkpoint();
            });
        }

        /* About dialog */
        function setup_about(id) {
            $(cockpit.info).on("changed", function() {
                $(id).text(cockpit.info.version);
                phantom_checkpoint();
            });
        }

        /* Account link */
        function setup_account(id, user) {
            $(id).on("click", function() {
                self.jump({ host: "localhost", component: "users", hash: "/" + user.name });
            }).show();
        }

        /* User information */
        function setup_user(id, user) {
            $(id).text(user.full_name || user.name || '???');

            var is_root = (user.name == "root");
            var is_not_root = (user.name && !is_root);
            $('#deauthorize-item').toggle(is_not_root);
        }

        if (self.oops_sel)
            setup_oops(self.oops_sel);

        if (self.logout_sel)
            setup_logout(self.logout_sel);

        if (self.language_sel)
            setup_language(self.language_sel);

        var cal_title;
        if (self.brand_sel) {
            cal_title = setup_brand(self.brand_sel, self.default_title);
            if (cal_title)
                self.default_title = cal_title;
        }

        if (self.about_sel)
            setup_about(self.about_sel);

        if (self.user_sel || self.account_sel) {
            cockpit.user().done(function (user) {
                if (self.user_sel)
                    setup_user(self.user_sel, user);
                if (self.account_sel)
                    setup_account(self.account_sel, user);
            });
        }
    }

    function CompiledComponants() {
        var self = this;
        self.items = {};

        self.load = function(manifests, section) {
            $.each(manifests || { }, function(name, manifest) {
                $.each(manifest[section] || { }, function(prop, info) {
                    var item = {
                        section: section,
                        label: cockpit.gettext(info.label) || prop,
                        order: info.order === undefined ? 1000 : info.order,
                        wants: info.wants
                    };
                    if (info.path)
                        item.path = info.path.replace(/\.html$/, "");
                    else
                        item.path = name + "/" + prop;
                    if (item.path.indexOf("/") === -1)
                        item.path = name + "/" + item.path;
                    if (item.path.slice(-6) == "/index")
                        item.path = item.path.slice(0, -6);
                    self.items[item.path] = item;
                });
            });
        };


        self.ordered = function(section) {
            var x, list = [];
            for (x in self.items) {
                if (!section || self.items[x].section === section)
                    list.push(self.items[x]);
            }
            list.sort(function(a, b) { return a.order - b.order; });
            return list;
        };

        self.search = function(prop, value) {
            var x;
            for (x in self.items) {
                if (self.items[x][prop] === value)
                    return self.items[x];
            }
        };
    }

    function follow(arg) {
        /* A promise of some sort */
        if (arguments.length == 1 && typeof arg.then == "function") {
            arg.then(function() { console.log.apply(console, arguments); },
                     function() { console.error.apply(console, arguments); });
            if (typeof arg.stream == "function")
                arg.stream(function() { console.log.apply(console,arguments); });
        }
    }

    var zz_value;

    /* For debugging utility in the index window */
    Object.defineProperties(window, {
        cockpit: { value: cockpit },
        zz: {
            get: function() { return zz_value; },
            set: function(val) { zz_value = val; follow(val); }
        }
    });

    module.exports = {
        new_index_from_proto: function (proto) {
            var o = new Object(proto);
            Index.call(o);
            return o;
        },

        new_compiled: function () {
            return new CompiledComponants();
        },
    };
}());
