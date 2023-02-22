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

import React from "react";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";

import cockpit from "cockpit";
import * as utils from "./utils.js";

const _ = cockpit.gettext;

export class SwapTab extends React.Component {
    constructor(props) {
        super(props);
        this.onSamplesChanged = this.onSamplesChanged.bind(this);
    }

    onSamplesChanged() {
        this.setState({});
    }

    componentDidMount() {
        this.props.client.swap_sizes.addEventListener("changed", this.onSamplesChanged);
    }

    componentWillUnmount() {
        this.props.client.swap_sizes.removeEventListener("changed", this.onSamplesChanged);
    }

    render() {
        const self = this;
        const block_swap = self.props.client.blocks_swap[self.props.block.path];
        const is_active = block_swap && block_swap.Active;
        let used;

        if (is_active) {
            const samples = self.props.client.swap_sizes.data[utils.decode_filename(self.props.block.Device)];
            if (samples)
                used = utils.fmt_size(samples[0] - samples[1]);
            else
                used = _("Unknown");
        } else {
            used = "-";
        }

        return (
            <DescriptionList className="pf-m-horizontal-on-sm">
                <DescriptionListGroup>
                    <DescriptionListTerm>{_("Used")}</DescriptionListTerm>
                    <DescriptionListDescription>{used}</DescriptionListDescription>
                </DescriptionListGroup>
            </DescriptionList>
        );
    }
}
