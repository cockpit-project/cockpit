/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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

import React from 'react';

import { Alert, AlertActionCloseButton } from '@patternfly/react-core';

import cockpit from "cockpit";

import './motdCard.scss';

export class MotdCard extends React.Component {
    constructor() {
        super();
        this.state = { motdText: "", motdVisible: false };

        this.hideAlert = () => {
            this.setState({ motdVisible: false });
            cockpit.localStorage.setItem('dismissed-motd', this.state.motdText);
        };
    }

    componentDidMount() {
        cockpit.file("/etc/motd").watch(content => {
            /* trim initial empty lines and trailing space, but keep initial spaces to not break ASCII art */
            if (content)
                content = content.trimRight().replace(/^\s*\n/, '');
            if (content && content != cockpit.localStorage.getItem('dismissed-motd')) {
                this.setState({ motdText: content, motdVisible: true });
            } else {
                this.setState({ motdVisible: false });
            }
        });
    }

    render() {
        if (!this.state.motdVisible)
            return null;

        return (
            <Alert id="motd-box" isInline variant="default" className="motd-box"
                   title={ <pre id="motd">{this.state.motdText}</pre> }
                   actionClose={ <AlertActionCloseButton onClose={this.hideAlert} /> } />
        );
    }
}
