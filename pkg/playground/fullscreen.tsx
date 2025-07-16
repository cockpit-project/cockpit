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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import React from "react";
import { createRoot, Container } from 'react-dom/client';
import { usePageLocation } from "hooks";

import '../lib/patternfly/patternfly-6-cockpit.scss';

import { Page, PageSection, Bullseye, Button } from '@patternfly/react-core';

import 'cockpit-dark-theme'; // once per page
import 'page.scss';

const FullscreenDemo = () => {
    const { path } = usePageLocation();

    function go_fullscreen() {
        cockpit.location.go("/fullscreen");
    }

    function go_halfscreen() {
        cockpit.location.go("/");
    }

    return (
        <Page className="no-masthead-sidebar">
            <PageSection>
                <Bullseye>
                    { (path[0] != "fullscreen")
                        ? <Button onClick={go_fullscreen}>Go fullscreen</Button>
                        : <Button onClick={go_halfscreen}>Go back</Button>
                    }
                </Bullseye>
            </PageSection>
        </Page>
    );
};

function init_app(rootElement: Container) {
    const root = createRoot(rootElement);
    root.render(<FullscreenDemo />);
}

document.addEventListener("DOMContentLoaded", function() {
    cockpit.transport.wait(function() {
        init_app(document.getElementById('app')!);
    });
});
