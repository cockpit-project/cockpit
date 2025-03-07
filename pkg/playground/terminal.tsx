/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2025 Red Hat, Inc.
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
import React, { useState } from "react";
import { createRoot, Container } from 'react-dom/client';

import '../lib/patternfly/patternfly-6-cockpit.scss';

import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { ToggleGroup, ToggleGroupItem } from "@patternfly/react-core/dist/esm/components/ToggleGroup/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Split, SplitItem } from "@patternfly/react-core/dist/esm/layouts/Split/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";

import { useObject } from 'hooks';
import { Terminal, TerminalState } from 'cockpit-components-terminal';

import 'cockpit-dark-theme'; // once per page
import 'page.scss';

function create_channel() {
    return cockpit.channel({
        payload: "stream",
        spawn: ["/bin/bash"],
        environ: [
            "TERM=xterm-256color",
        ],
        directory: "/",
        pty: true,
    });
}

function create_states(n: number): TerminalState[] {
    const states = [];
    for (let i = 0; i < n; i++)
        states.push(new TerminalState(create_channel()));
    return states;
}

function close_states(states: TerminalState[]) {
    states.forEach(s => s.close());
}

const TabbedTerminal = () => {
    const num_terminals = 4;
    const states = useObject(() => create_states(num_terminals), states => close_states(states), []);
    const [tab, setTab] = useState<number>(0);

    function make_toggles() {
        const res = [];

        for (let i = 0; i < num_terminals; i++) {
            const t = i;
            res.push(<ToggleGroupItem
                         key={t}
                         text={"Terminal " + String(t + 1)}
                         isSelected={tab == t}
                         onChange={() => setTab(t)}
            />);
        }

        return res;
    }

    return (
        <PageSection isFilled hasBodyWrapper={false}>
            <Split>
                <SplitItem>
                    <ToggleGroup>
                        {make_toggles()}
                    </ToggleGroup>
                </SplitItem>
                <SplitItem isFilled />
                <SplitItem>
                    <Button variant="secondary" onClick={() => states[tab].resetChannel(create_channel())}>
                        Reset
                    </Button>
                </SplitItem>
            </Split>
            <div id="terminal" style={{ height: "100%" }}>
                <Terminal
                    parentId="terminal"
                    state={states[tab]}
                    cols={80}
                    rows={40}
                />
            </div>
        </PageSection>
    );
};

const TerminalDemo = () => {
    const [showTerminal, setShowTerminal] = useState(true);

    return (
        <Page isContentFilled className="no-masthead-sidebar">
            <PageSection>
                <Switch
                    label="Show terminals"
                    isChecked={showTerminal}
                    onChange={(_event: React.FormEvent<HTMLInputElement>, checked: boolean) => setShowTerminal(checked)}
                />
            </PageSection>
            { showTerminal && <TabbedTerminal /> }
        </Page>
    );
};

function init_app(rootElement: Container) {
    const root = createRoot(rootElement);
    root.render(<TerminalDemo />);
}

document.addEventListener("DOMContentLoaded", function() {
    cockpit.transport.wait(function() {
        init_app(document.getElementById('app')!);
    });
});
