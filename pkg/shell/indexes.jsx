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

import 'cockpit-dark-theme'; // once per page
import cockpit from "cockpit";
import React from "react";
import { createRoot } from "react-dom/client";

import { CockpitNav, CockpitNavItem, SidebarToggle } from "./nav.jsx";
import { TopNav } from ".//topnav.jsx";
import { CockpitHosts } from "./hosts.jsx";
import { codes, HostModal } from "./hosts_dialog.jsx";
import { EarlyFailure, EarlyFailureReady } from './failures.jsx';
import { WithDialogs } from "dialogs.jsx";

import * as base_index from "./base_index";

const _ = cockpit.gettext;

function MachinesIndex(index_options, machines, loader) {
    if (!index_options)
        index_options = {};

    const root = id => createRoot(document.getElementById(id));

    // Document is guaranteed to be loaded at this point.
    const sidebar_toggle_root = root('sidebar-toggle');
    const early_failure_root = root('early-failure');
    const early_failure_ready_root = root('early-failure-ready');
    const topnav_root = root('topnav');
    const hosts_sel_root = root('hosts-sel');
    let host_apps_root = null;

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
    index.addEventListener("expect_restart", (ev, host) => loader.expect_restart(host));

    /* Disconnection Dialog */
    let watchdog_problem = null;
    index.addEventListener("disconnect", (ev, problem) => {
        watchdog_problem = problem;
        show_disconnected();
    });

    index.addEventListener("update", () => {
        update_topbar();
    });

    /* Is troubleshooting dialog open */
    let troubleshooting_opened = false;

    sidebar_toggle_root.render(<SidebarToggle />);

    // Focus with skiplinks
    const skiplinks = document.getElementsByClassName("skiplink");
    Array.from(skiplinks).forEach(skiplink => {
        skiplink.addEventListener("click", ev => {
            document.getElementById(ev.target.hash.substring(1)).focus();
            return false;
        });
    });

    let current_user = "";
    cockpit.user().then(user => {
        current_user = user.name || "";
    }).catch(exc => console.log(exc));

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
    machines.addEventListener("ready", on_ready);
    machines.addEventListener("removed", (ev, machine) => {
        index.frames.remove(machine);
        update_machines();
    });
    ["added", "updated"].forEach(evn => {
        machines.addEventListener(evn, (ev, machine) => {
            if (!machine.visible)
                index.frames.remove(machine);
            else if (machine.problem)
                index.frames.remove(machine);

            update_machines();
            preload_frames();
            if (ready)
                navigate();
        });
    });

    if (machines.ready)
        on_ready();

    function show_disconnected() {
        if (!ready) {
            document.getElementById("early-failure-ready").setAttribute("hidden", "hidden");
            document.getElementById("early-failure").removeAttribute("hidden");

            const ca_cert_url = window.sessionStorage.getItem("CACertUrl");
            early_failure_root.render(<EarlyFailure ca_cert_url={
                (window.navigator.userAgent.indexOf("Safari") >= 0 && ca_cert_url) ? ca_cert_url : undefined
            } />);
            document.getElementById("main").setAttribute("hidden", "hidden");
            document.body.removeAttribute("hidden");
            return;
        }

        const current_frame = index.current_frame();

        if (current_frame)
            current_frame.setAttribute("hidden", "hidden");

        document.getElementById("early-failure").setAttribute("hidden", "hidden");
        document.getElementById("early-failure-ready").removeAttribute("hidden");

        early_failure_ready_root.render(
            <EarlyFailureReady title={_("Disconnected")}
                               reconnect
                               watchdog_problem={watchdog_problem}
                               navigate={navigate}
                               paragraph={cockpit.message(watchdog_problem)} />);
    }

    /* Handles navigation */
    function navigate(state, reconnect) {
        /* If this is a watchdog problem or we are troubleshooting
         * let the dialog handle it */
        if (watchdog_problem || troubleshooting_opened)
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
        update_topbar(machine, state, compiled);
        update_frame(machine, state, compiled);

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

    function update_topbar(machine, state, compiled) {
        if (!state)
            state = index.retrieve_state();

        if (!machine)
            machine = machines.lookup(state.host);

        if (!compiled)
            compiled = compile(machine);

        topnav_root.render(
            <WithDialogs>
                <TopNav index={index} state={state} machine={machine} compiled={compiled} />
            </WithDialogs>);
    }

    function update_navbar(machine, state, compiled) {
        if (!state)
            state = index.retrieve_state();

        if (!machine)
            machine = machines.lookup(state.host);

        if (!machine || machine.state != "connected") {
            if (host_apps_root) {
                host_apps_root.unmount();
                host_apps_root = null;
            }
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
                        best = { keyword: m, score };
                    }
                });
                if (best.score > current_best.score) {
                    current_best = { keyword: best.keyword, score: best.score, goto: item.goto || null };
                }
                return current_best;
            }

            const new_item = Object.assign({}, item);
            new_item.keyword = { score: -1 };
            if (!term)
                return new_item;
            const best_keyword = new_item.keywords.reduce(keyword_relevance, { score: -1 });
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
                active,
                status,
                keyword: component.keyword.keyword,
                term,
                to: index.href({ host: machine.address, component: path, hash }),
                jump: index.jump,
            });
        }

        const groups = [
            {
                name: _("Apps"),
                items: compiled.ordered("dashboard"),
            }, {
                name: _("System"),
                items: compiled.ordered("menu"),
            }, {
                name: _("Tools"),
                items: compiled.ordered("tools"),
            }
        ].filter(i => i.items.length > 0);

        if (compiled.items.apps && groups.length === 3)
            groups[0].action = { label: _("Edit"), path: index.href({ host: machine.address, component: compiled.items.apps.path }) };

        if (!host_apps_root)
            host_apps_root = root('host-apps');
        host_apps_root.render(
            React.createElement(CockpitNav, {
                groups,
                selector: "host-apps",
                item_render: nav_item,
                filtering: keyword_filter,
                sorting: (a, b) => { return b.keyword.score - a.keyword.score },
                current: state.component,
                jump: index.jump,
            }));

        update_machines(state, machine);
    }

    function update_machines(state, machine) {
        if (!state)
            state = index.retrieve_state();

        if (!machine)
            machine = machines.lookup(state.host);

        hosts_sel_root.render(
            React.createElement(CockpitHosts, {
                machine: machine || {},
                machines,
                selector: "nav-hosts",
                hostAddr: index.href,
                jump: index.jump,
            }));
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

    let troubleshoot_dialog_root = null;

    function update_frame(machine, state, compiled) {
        function render_troubleshoot() {
            troubleshooting_opened = true;
            const template = codes[machine.problem] || "change-port";
            if (!troubleshoot_dialog_root)
                troubleshoot_dialog_root = root('troubleshoot-dialog');
            troubleshoot_dialog_root.render(React.createElement(HostModal, {
                template,
                address: machine.address,
                machines_ins: machines,
                onClose: () => {
                    troubleshoot_dialog_root.unmount();
                    troubleshoot_dialog_root = null;
                    troubleshooting_opened = false;
                    navigate(null, true);
                }
            }));
        }

        let current_frame = index.current_frame();

        if (machine.state != "connected") {
            if (current_frame)
                current_frame.setAttribute("hidden", "hidden");
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

            let troubleshooting = false;

            if (!machine.restarting && (machine.problem === "no-host" || !!codes[machine.problem])) {
                troubleshooting = true;
            }

            const restarting = !!machine.restarting;
            const reconnect = !connecting && machine.problem != "not-found" && !troubleshooting;

            document.querySelector("#early-failure-ready").removeAttribute("hidden");
            early_failure_ready_root.render(
                <EarlyFailureReady loading={connecting || restarting}
                                   title={title}
                                   reconnect={reconnect}
                                   troubleshoot={troubleshooting}
                                   onTroubleshoot={render_troubleshoot}
                                   watchdog_problem={watchdog_problem}
                                   navigate={navigate}
                                   paragraph={message} />);

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
            if (current_frame) {
                current_frame.style.display = "none";
                // Reset 'data-active' only on the same host
                if (frame.getAttribute('data-host') === current_frame.getAttribute('data-host'))
                    current_frame.setAttribute('data-active', 'false');
            }
            index.current_frame(frame);
        }

        if (machine.state == "connected") {
            document.querySelector("#early-failure-ready").setAttribute("hidden", "hidden");
            frame.style.display = "block";
            frame.setAttribute('data-active', 'true');
            frame.removeAttribute("hidden");

            const component_manifest = find_component(state, compiled);
            const item = compiled.items[component_manifest];
            const label = item ? item.label : "";
            update_title(label, machine);
            if (label)
                frame.setAttribute('title', label);
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
if (document.documentElement.classList.contains("index-page")) {
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
        language = navigator.language.toLowerCase(); // Default to Accept-Language header

    document.documentElement.lang = language;
    if (cockpit.language_direction)
        document.documentElement.dir = cockpit.language_direction;

    window.addEventListener("message", message_queue, false);
}

export function machines_index(options, machines_ins, loader) {
    return new MachinesIndex(options, machines_ins, loader);
}
