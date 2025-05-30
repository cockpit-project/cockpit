/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2024 Red Hat, Inc.
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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";

import React, { useEffect } from 'react';
import { createRoot } from "react-dom/client";

import { WithDialogs } from "dialogs.jsx";
import { useInit, useEvent, useOn, useLoggedInUser } from "hooks";

import { TopNav } from "./topnav.jsx";
import { SidebarToggle, PageNav } from "./nav.jsx";
import { CockpitHosts, CockpitCurrentHost } from "./hosts.jsx";
import { HostModalState, HostModal, connect_host } from "./hosts_dialog.jsx";
import { Frames } from "./frames.jsx";
import { EarlyFailure, Disconnected, MachineTroubleshoot } from "./failures.jsx";

import { ShellState } from "./state.jsx";
import { IdleTimeoutState, FinalCountdownModal } from "./idle.jsx";

import { SkipToContent } from '@patternfly/react-core';

import 'cockpit-dark-theme'; // once per page

import '../lib/patternfly/patternfly-6-cockpit.scss';
import "./shell.scss";

const _ = cockpit.gettext;

interface SkipLinkProps {
    focus_id: string;
    children?: React.ReactNode
}

// We create a wrapper specifically to handle edge-cases like headless browsers
// not getting focus when clicking an anchor to a heading. We can also scroll
// it into view in case it wouldn't do that before - just to be safe.
const SkipLink = ({ focus_id, children }: SkipLinkProps) => {
    return (
        <SkipToContent
            href={`#${focus_id}`}
            onClick={ev => {
                const el = document.getElementById(focus_id);
                el?.focus();
                el?.scrollIntoView();
                ev.preventDefault();
            }}>
            {children}
        </SkipToContent>
    );
};

const Shell = () => {
    const current_user = useLoggedInUser()?.name || "";
    const state = useInit(() => new ShellState());
    const idle_state = useInit(() => new IdleTimeoutState());
    const host_modal_state = useInit(() => HostModalState());

    useOn(state, "update");
    useOn(idle_state, "update");
    useEvent(host_modal_state, "changed");

    useEffect(() => {
        return state.on("connect", () => {
            connect_host(host_modal_state, state, state.current_machine);
        });
    }, [host_modal_state, state]);

    const {
        ready, problem,

        config,

        current_machine,
        current_manifest_item,
    } = state;

    if (problem && !ready)
        return <EarlyFailure />;

    if (!ready)
        return null;

    cockpit.assert(current_machine && current_manifest_item);

    const title_parts = [];
    if (current_manifest_item.label)
        title_parts.push(current_manifest_item.label);
    title_parts.push((current_machine.user || current_user) + "@" + current_machine.label);
    document.title = title_parts.join(" - ");

    if (idle_state.final_countdown)
        document.title = "(" + idle_state.final_countdown + ") " + document.title;

    document.documentElement.lang = config.language;
    if (config.language_direction)
        document.documentElement.dir = config.language_direction;

    let failure = null;
    if (problem) {
        failure = <Disconnected problem={problem} />;
    } else if (current_machine.state != "connected") {
        failure = <MachineTroubleshoot machine={current_machine}
                                       onClick={() => connect_host(host_modal_state, state, current_machine)} />;
    }

    return (
        <div id="main" className="page"
             style={
                 {
                     '--ct-color-host-accent': (current_machine.address == "localhost" ? undefined : current_machine.color)
                 } as React.CSSProperties
             }>

            <SkipLink focus_id="content">{_("Skip to content")}</SkipLink>
            <SkipLink focus_id="hosts-sel">{_("Skip main navigation")}</SkipLink>

            <div id="sidebar-toggle" className="pf-v6-c-select pf-m-dark sidebar-toggle">
                <SidebarToggle />
            </div>

            <div id="nav-system" className="area-ct-subnav nav-system-menu sidebar interact">
                <nav id="host-apps" className="host-apps">
                    <PageNav state={state} />
                </nav>
            </div>

            <nav id="hosts-sel" className="navbar navbar-default navbar-pf navbar-pf-vertical" tabIndex={-1}>
                { config.host_switcher_enabled
                    ? <CockpitHosts state={state} host_modal_state={host_modal_state} selector="nav-hosts" />
                    : <CockpitCurrentHost current_user={current_user} machine={current_machine} />
                }
            </nav>

            <div id="nav-hosts" className="area-ct-subnav nav-hosts-menu sidebar" />

            <div id="topnav" className="header">
                <TopNav state={state} />
            </div>

            <Frames hidden={!!failure} state={state} idle_state={idle_state} />

            { failure &&
            <div id="failure-content" className="area-ct-content" role="main" tabIndex={-1}>
                { failure }
            </div>
            }

            <FinalCountdownModal state={idle_state} />
            <HostModal state={host_modal_state} machines={state.machines} />

        </div>);
};

interface ShellWindow extends Window {
    features?: object;
}

function init() {
    cockpit.translate();

    /* Give us a name.  This used to (maybe) indicate at some point to
     * child frames that we are a cockpit1 router frame.  But they
     * actually check for a "cockpit1:" prefix of their own name.
     */
    window.name = "cockpit1";

    /* Tell the pages about our features. */
    (window as ShellWindow).features = {
        navbar_is_for_current_machine: true
    };

    function follow(arg: unknown) {
        /* A promise of some sort */
        if (arguments.length == 1 && arg && typeof arg == "object" && "then" in arg && typeof arg.then == "function") {
            arg.then(function(...args: unknown[]) { console.log(...args) },
                     function(...args: unknown[]) { console.error(...args) });
            if ("stream" in arg && typeof arg.stream == "function")
                arg.stream(function(...args: unknown[]) { console.log(...args) });
        }
    }

    let zz_value: unknown;

    /* For debugging in the browser console */
    Object.defineProperties(window, {
        cockpit: { value: cockpit },
        zz: {
            get: function() { return zz_value },
            set: function(val) { zz_value = val; follow(val) }
        }
    });

    const root = createRoot(document.getElementById("shell")!);
    root.render(<WithDialogs><Shell /></WithDialogs>);
}

document.addEventListener("DOMContentLoaded", init);
