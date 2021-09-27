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

import $ from "jquery";
import "bootstrap/dist/js/bootstrap";

import cockpit from "cockpit";
import React from "react";
import ReactDOM from "react-dom";

import { SuperuserIndicator } from "./superuser.jsx";
import { CockpitNav, CockpitNavItem } from "./nav.jsx";
import { CockpitHosts } from "./hosts.jsx";
import { AboutCockpitModal } from "./shell-modals.jsx";

import * as base_index from "./base_index";

const _ = cockpit.gettext;

function MachinesIndex(index_options, machines, loader, mdialogs) {
    if (!index_options)
        index_options = {};

    const page_status = { };
    sessionStorage.removeItem("cockpit:page_status");

    index_options.navigate = function (state, sidebar) {
        return navigate(state, sidebar);
    };
    index_options.handle_notifications = function (host, page, data) {
        if (data.page_status !== undefined) {
            if (!page_status[host])
                page_status[host] = { };
            page_status[host][page] = data.page_status;
            sessionStorage.setItem("cockpit:page_status", JSON.stringify(page_status));
            // Just for triggering an "updated" event
            machines.overlay(host, { });
        }
    };

    const index = base_index.new_index_from_proto(index_options);

    /* Restarts */
    $(index).on("expect_restart", function (ev, host) {
        loader.expect_restart(host);
    });

    /* Disconnection Dialog */
    let watchdog_problem = null;
    $(index).on("disconnect", function (ev, problem) {
        watchdog_problem = problem;
        show_disconnected();
    });

    /* Is troubleshooting dialog open */
    let troubleshooting = false;

    $("#nav-system-item").on("click", function (ev) {
        $(this).toggleClass("active");
        $("#nav-system").toggleClass("interact");
        ev.preventDefault();
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

    // Focus with skiplinks
    $(".skiplink").on("click", ev => {
        $(ev.target.hash).focus();
        return false;
    });

    let current_user = "";
    cockpit.user().then(user => {
        current_user = user.name || "";
    });

    /* Navigation */
    let ready = false;
    function on_ready() {
        ready = true;
        index.ready();
    }

    function preload_frames () {
        for (const m of machines.list)
            index.preload_frames(m, m.manifests);
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
                preload_frames();
                if (ready)
                    navigate();
            })
            .on("removed", function(ev, machine) {
                index.frames.remove(machine);
                update_machines();
            });

    if (machines.ready)
        on_ready();

    function show_disconnected() {
        if (!ready) {
            const ca_cert_url = window.sessionStorage.getItem("CACertUrl");
            if (window.navigator.userAgent.indexOf("Safari") >= 0 && ca_cert_url) {
                $("#safari-cert-help a").attr("href", ca_cert_url);
                $("#safari-cert-help").prop("hidden", false);
            }
            $("#early-failure").prop("hidden", false);
            $("#main").hide();
            $("body").prop("hidden", false);
            return;
        }

        const current_frame = index.current_frame();

        if (current_frame)
            $(current_frame).hide();

        $(".curtains-ct .spinner").prop("hidden", true);
        $("#machine-reconnect").toggle(true);
        $("#machine-troubleshoot").toggle(false);
        $(".curtains-ct i").toggle(true);
        $(".curtains-ct h1").text(_("Disconnected"));
        $(".curtains-ct p").text(cockpit.message(watchdog_problem));
        $(".curtains-ct").prop("hidden", false);
        $("#navbar-dropdown").addClass("disabled");
    }

    /* Handles navigation */
    function navigate(state, reconnect) {
        /* If this is a watchdog problem or we are troubleshooting
         * let the dialog handle it */
        if (watchdog_problem || troubleshooting)
            return;

        if (!state)
            state = index.retrieve_state();
        let machine = machines.lookup(state.host);

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
        } else if (reconnect) {
            loader.connect(state.host);
        }

        const compiled = compile(machine);
        if (machine.manifests && !state.component)
            state.component = choose_component(state, compiled);

        update_navbar(machine, state, compiled);
        update_frame(machine, state, compiled);
        update_docs(machine, state, compiled);
        update_superuser(machine, state, compiled);

        /* Just replace the state, and URL */
        index.jump(state, true);
    }

    function choose_component(state, compiled) {
        /* Go for the first item */
        const menu_items = compiled.ordered("menu");
        if (menu_items.length > 0 && menu_items[0])
            return menu_items[0].path;

        return "system";
    }

    function update_navbar(machine, state, compiled) {
        if (!state)
            state = index.retrieve_state();

        if (!machine)
            machine = machines.lookup(state.host);

        if (!machine || machine.state != "connected") {
            ReactDOM.unmountComponentAtNode(document.getElementById("host-apps"));
            return;
        }

        if (!compiled)
            compiled = compile(machine);

        if (machine.address !== "localhost") {
            document.getElementById("main").style.setProperty('--ct-color-host-accent', machine.color);
        } else {
            // Remove property to fall back to default accent color
            document.getElementById("main").style.removeProperty('--ct-color-host-accent');
        }

        const component_manifest = find_component(state, compiled);

        // Filtering of navigation by term
        function keyword_filter(item, term) {
            function keyword_relevance(current_best, item) {
                const translate = item.translate || false;
                const weight = item.weight || 0;
                let score;
                let _m = "";
                let best = { score: -1 };
                item.matches.forEach(m => {
                    if (translate)
                        _m = _(m);
                    score = -1;
                    // Best score when starts in translate language
                    if (translate && _m.indexOf(term) == 0)
                        score = 4 + weight;
                    // Second best score when starts in English
                    else if (m.indexOf(term) == 0)
                        score = 3 + weight;
                    // Substring consider only when at least 3 letters were used
                    else if (term.length >= 3) {
                        if (translate && _m.indexOf(term) >= 0)
                            score = 2 + weight;
                        else if (m.indexOf(term) >= 0)
                            score = 1 + weight;
                    }
                    if (score > best.score) {
                        best = { keyword: m, score: score };
                    }
                });
                if (best.score > current_best.score) {
                    current_best = { keyword: best.keyword, score: best.score, goto: item.goto || null };
                }
                return current_best;
            }

            const new_item = Object.assign({}, item);
            new_item.keyword = { score:-1 };
            if (!term)
                return new_item;
            const best_keyword = new_item.keywords.reduce(keyword_relevance, { score:-1 });
            if (best_keyword.score > -1) {
                new_item.keyword = best_keyword;
                return new_item;
            }
            return null;
        }

        // Rendering of separate navigation menu items
        function nav_item(component, term) {
            const active = component_manifest === component.path;

            // Parse path
            let path = component.path;
            let hash = component.hash;
            if (component.keyword.goto) {
                if (component.keyword.goto[0] === "/")
                    path = component.keyword.goto.substr(1);
                else
                    hash = component.keyword.goto;
            }

            // Parse page status
            let status = null;
            if (page_status[machine.key])
                status = page_status[machine.key][component.path];

            return React.createElement(CockpitNavItem, {
                key: component.label,
                name: component.label,
                active: active,
                status: status,
                keyword: component.keyword.keyword,
                term: term,
                to: index.href({ host: machine.address, component: path, hash: hash }),
                jump: index.jump,
            });
        }

        const groups = [
            {
                name: _("Apps"),
                items: compiled.ordered("dashboard"),
            }, {
                name:  _("System"),
                items: compiled.ordered("menu"),
            }, {
                name: _("Tools"),
                items: compiled.ordered("tools"),
            }
        ].filter(i => i.items.length > 0);

        if (compiled.items.apps && groups.length === 3)
            groups[0].action = { label: _("Edit"), path: index.href({ host: machine.address, component: compiled.items.apps.path }) };

        ReactDOM.render(
            React.createElement(CockpitNav, {
                groups: groups,
                selector: "host-apps",
                item_render: nav_item,
                filtering: keyword_filter,
                sorting: (a, b) => { return b.keyword.score - a.keyword.score },
                current: state.component,
                jump: index.jump,
            }),
            document.getElementById("host-apps"));

        update_machines(state, machine);
    }

    function update_machines(state, machine) {
        if (!state)
            state = index.retrieve_state();

        if (!machine)
            machine = machines.lookup(state.host);

        ReactDOM.render(
            React.createElement(CockpitHosts, {
                machine: machine || {},
                machines: machines,
                selector: "nav-hosts",
                hostAddr: index.href,
                jump: index.jump,
            }),
            document.getElementById("hosts-sel"));
    }

    function update_docs(machine, state, compiled) {
        let docs = [];

        const item = compiled.items[state.component];
        if (item && item.docs)
            docs = item.docs;

        // Check for parent as well
        if (docs.length === 0) {
            const comp = cockpit.manifests[state.component];
            if (comp && comp.parent && comp.parent.docs)
                docs = comp.parent.docs;
        }

        const docs_items = document.getElementById("navbar-docs-items");
        docs_items.innerHTML = "";

        function create_item(name, url) {
            const el_li = document.createElement("li");
            const el_a = document.createElement("a");
            const el_icon = document.createElement("i");
            el_icon.className = "fa fa-external-link fa-xs";
            el_a.setAttribute("translate", "yes");
            el_a.setAttribute("href", url);
            el_a.setAttribute("target", "blank");
            el_a.setAttribute("rel", "noopener noreferrer");

            el_a.appendChild(document.createTextNode(name));
            el_a.appendChild(el_icon);

            el_li.appendChild(el_a);
            docs_items.appendChild(el_li);
        }

        const os_release = JSON.parse(window.localStorage['os-release'] || "{}");
        if (os_release.DOCUMENTATION_URL)
            create_item(cockpit.format(_("$0 documentation"), os_release.NAME), os_release.DOCUMENTATION_URL);

        create_item(_("Web Console"), "https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/8/html/managing_systems_using_the_rhel_8_web_console/index");

        docs.forEach(e => create_item(_(e.label), e.url));

        // Add 'About Web Console' item
        const divider = document.createElement("li");
        divider.className = "divider";
        const about = document.createElement("li");
        const el_a = document.createElement("a");
        el_a.onclick = () => {
            ReactDOM.render(React.createElement(AboutCockpitModal, {
                onClose: () =>
                    ReactDOM.unmountComponentAtNode(document.getElementById('about'))
            }),
                            document.getElementById('about'));
        };
        el_a.appendChild(document.createTextNode(_("About Web Console")));
        about.appendChild(el_a);

        docs_items.appendChild(divider);
        docs_items.appendChild(about);
    }

    function update_superuser(machine, state, compiled) {
        if (machine.state == "connected") {
            ReactDOM.render(React.createElement(SuperuserIndicator, { host: machine.connection_string }),
                            document.getElementById('super-user-indicator'));
            ReactDOM.render(React.createElement(SuperuserIndicator, { host: machine.connection_string }),
                            document.getElementById('super-user-indicator-mobile'));
        } else {
            ReactDOM.unmountComponentAtNode(document.getElementById('super-user-indicator'));
            ReactDOM.unmountComponentAtNode(document.getElementById('super-user-indicator-mobile'));
        }
    }

    function update_title(label, machine) {
        if (label)
            label += " - ";
        else
            label = "";
        let suffix = index.default_title;

        if (machine) {
            if (machine.address === "localhost") {
                const compiled = compile(machine);
                if (compiled.ordered("menu").length || compiled.ordered("tools").length)
                    suffix = (machine.user || current_user) + "@" + machine.label;
            } else {
                suffix = (machine.user || current_user) + "@" + machine.label;
            }
        }

        document.title = label + suffix;
    }

    function find_component(state, compiled) {
        let component = state.component;
        // If `state.component` is not known to any manifest, find where it comes from
        if (compiled.items[state.component] === undefined) {
            let s = state.component;
            while (s && compiled.items[s] === undefined)
                s = s.substring(0, s.lastIndexOf("/"));
            component = s;
        }

        // Still don't know where it comes from, check for parent
        if (!component) {
            const comp = cockpit.manifests[state.component];
            if (comp && comp.parent)
                return comp.parent.component;
        }

        return component;
    }

    function update_frame(machine, state, compiled) {
        let current_frame = index.current_frame();

        if (machine.state != "connected") {
            $(current_frame).hide();
            current_frame = null;
            index.current_frame(current_frame);

            const connecting = (machine.state == "connecting");
            let title, message;
            if (machine.restarting) {
                title = _("The machine is rebooting");
                message = "";
            } else if (connecting) {
                title = _("Connecting to the machine");
                message = "";
            } else {
                title = _("Not connected to host");
                if (machine.problem == "not-found") {
                    message = _("Cannot connect to an unknown host");
                } else {
                    const error = machine.problem || machine.state;
                    if (error)
                        message = cockpit.message(error);
                    else
                        message = "";
                }
            }

            let troubleshooting;
            if (!machine.restarting && mdialogs.needs_troubleshoot(machine)) {
                $("#machine-troubleshoot").off()
                        .on("click", function () {
                            mdialogs.troubleshoot("troubleshoot-dialog", machine);
                        });
                troubleshooting = true;
                $("#machine-troubleshoot").show();
            } else {
                troubleshooting = false;
                $("#machine-troubleshoot").hide();
            }

            const restarting = !!machine.restarting;
            $(".curtains-ct").prop("hidden", false);
            $(".curtains-ct .spinner").prop("hidden", !connecting && !restarting);
            $("#machine-reconnect").toggle(!connecting && machine.problem != "not-found" && !troubleshooting);
            $(".curtains-ct i").toggle(!connecting && !restarting);
            $(".curtains-ct h1").text(title);
            $(".curtains-ct p").text(message);

            $("#machine-spinner").hide();

            update_title(null, machine);

            /* Fall through when connecting, and allow frame to load at same time */
            if (!connecting)
                return;
        }

        let hash = state.hash;
        let component = state.component;

        /* Old cockpit packages, used to be in shell/shell.html */
        if (machine && compiled.compat) {
            const compat = compiled.compat[component];
            if (compat) {
                component = "shell/shell";
                hash = compat;
            }
        }

        const frame = component ? index.frames.lookup(machine, component, hash) : undefined;
        if (frame != current_frame) {
            $(current_frame).css('display', 'none');
            if (current_frame)
                // Reset 'data-active' only on the same host
                if (frame.getAttribute('data-host') === current_frame.getAttribute('data-host'))
                    $(current_frame).attr('data-active', 'false');
            index.current_frame(frame);
        }

        if (machine.state == "connected") {
            $(".curtains-ct").prop("hidden", true);
            $("#machine-spinner").toggle(frame && !$(frame).attr("data-ready"));
            $(frame).css('display', 'block');
            $(frame).attr('data-active', 'true');

            const component_manifest = find_component(state, compiled);
            const item = compiled.items[component_manifest];
            const label = item ? item.label : "";
            update_title(label, machine);
            if (label)
                $(frame).attr('title', label);
        }
    }

    function compatibility(machine) {
        if (!machine.manifests || machine.address === "localhost")
            return null;

        const shell = machine.manifests.shell || { };
        const menu = shell.menu || { };
        const tools = shell.tools || { };

        const mapping = { };

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
        const compiled = base_index.new_compiled();
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

function message_queue(event) {
    window.messages.push(event);
}

/* When we're being loaded into the index window we have additional duties */
if (document.documentElement.getAttribute("class") === "index-page") {
    /* Indicates to child frames that we are a cockpit1 router frame */
    window.name = "cockpit1";

    /* The same thing as above, but compatibility with old cockpit */
    window.options = { sink: true, protocol: "cockpit1" };

    /* Tell the pages about our features. */
    window.features = {
        navbar_is_for_current_machine: true
    };

    /* While the index is initializing, snag any messages we receive from frames */
    window.messages = [];

    window.messages.cancel = function() {
        window.removeEventListener("message", message_queue, false);
        window.messages = null;
    };

    let language = document.cookie.replace(/(?:(?:^|.*;\s*)CockpitLang\s*=\s*([^;]*).*$)|^.*$/, "$1");
    if (!language)
        language = "en-us";
    document.documentElement.lang = language;

    window.addEventListener("message", message_queue, false);
}

export function machines_index(options, machines_ins, loader, mdialogs) {
    return new MachinesIndex(options, machines_ins, loader, mdialogs);
}
