/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

import cockpit from "cockpit";
import React from "react";

import { OptionalPanel } from "./optional-panel.jsx";
import { get_block_link_parts, block_name } from "./utils.js";

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { EmptyState, EmptyStateBody, EmptyStateVariant } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { ExclamationTriangleIcon } from '@patternfly/react-icons';

const _ = cockpit.gettext;

export class SidePanel extends React.Component {
    constructor() {
        super();
        this.state = { collapsed: true };
        this.current_rows_keys = [];
        this.new_keys = [];
    }

    render() {
        let show_all_button = null;
        let rows = this.props.rows.filter(row => !!row);

        // Find new items for animations
        const current_keys = rows.map(row => row.key);

        if (JSON.stringify(this.current_rows_keys) !== JSON.stringify(current_keys)) {
            if (this.current_rows_keys.length !== 0) {
                const new_keys = current_keys.filter(key => this.current_rows_keys.indexOf(key) === -1);
                if (new_keys.length)
                    this.new_keys.push(...new_keys);
            }
            this.current_rows_keys = current_keys;
        }

        // Collapse items by default if more than 20
        if (this.state.collapsed && rows.length > 20) {
            show_all_button = (
                <FlexItem alignSelf={{ default: 'alignSelfCenter' }}>
                    <Button variant='link'
                            onKeyPress={ev => ev.key === "Enter" && this.setState({ collapsed: false })}
                            onClick={() => { this.setState({ collapsed: false }) }}>
                        {this.props.show_all_text || _("Show all")}
                    </Button>
                </FlexItem>);
            rows = rows.slice(0, 20);
        }

        rows.forEach(row => {
            if (row.key && this.new_keys.indexOf(row.key) !== -1)
                row.className = (row.className || "") + " ct-new-item";
        });

        const children = rows.map(row => row.block ? <SidePanelBlockRow key={row.key} {...row} /> : <SidePanelRow key={row.key} {...row} />);

        return (
            <OptionalPanel id={this.props.id}
                           title={this.props.title}
                           actions={this.props.actions}
                           client={this.props.client}
                           feature={this.props.feature}
                           not_installed_text={this.props.not_installed_text}
                           install_title={this.props.install_title}>
                { this.props.rows.length > 0
                    ? <Flex direction={{ default: 'column' }}
                          spaceItems={{ default: 'spaceItemsNone' }}>
                        { children }
                        { show_all_button }
                    </Flex>
                    : <EmptyState variant={EmptyStateVariant.sm}>
                        <EmptyStateBody>
                            {this.props.empty_text}
                        </EmptyStateBody>
                    </EmptyState>
                }
            </OptionalPanel>
        );
    }
}

class SidePanelRow extends React.Component {
    render() {
        const { client, job_path } = this.props;

        const go = (event) => {
            if (!event)
                return;

            // only consider primary mouse button for clicks
            if (event.type === 'click' && event.button !== 0)
                return;

            // only consider enter button for keyboard events
            if (event.type === 'keypress' && event.key !== "Enter")
                return;

            return this.props.go();
        };

        const eat_event = (event) => {
            // Stop events from disabled actions. Otherwise they would
            // reach the <tr> element and cause spurious navigation.
            event.stopPropagation();
        };

        let decoration = null;
        if (this.props.actions)
            decoration = (
                <div role="presentation"
                     onClick={eat_event}
                     onKeyPress={eat_event}>
                    {this.props.actions}
                </div>);
        else if (client.path_jobs[job_path])
            decoration = <Spinner size="md" />;
        else if (client.path_warnings[job_path])
            decoration = <ExclamationTriangleIcon className="ct-icon-exclamation-triangle" />;

        return (
            <FlexItem data-testkey={this.props.testkey}
                      className={"sidepanel-row " + (this.props.className || "")}
                      role="link" tabIndex="0"
                      onKeyPress={this.props.go ? go : null}
                      onClick={this.props.go ? go : null}>
                <Flex flexWrap={{ default: 'nowrap' }}>
                    <FlexItem grow={{ default: 'grow' }} className="sidepanel-row-name pf-v5-u-text-break-word">{this.props.name}</FlexItem>
                    <FlexItem>{decoration}</FlexItem>
                </Flex>
                <Flex className="sidepanel-row-info">
                    <FlexItem grow={{ default: 'grow' }} className="sidepanel-row-detail">{this.props.detail}</FlexItem>
                    <FlexItem className="sidepanel-row-devname pf-v5-u-text-break-word">{this.props.devname}</FlexItem>
                </Flex>
            </FlexItem>
        );
    }
}

class SidePanelBlockRow extends React.Component {
    render() {
        const { client, block, detail, actions } = this.props;

        const parts = get_block_link_parts(client, block.path);
        const name = cockpit.format(parts.format, parts.link);
        const backing = client.blocks[block.CryptoBackingDevice];

        return <SidePanelRow client={client}
                             name={name}
                             devname={block_name(backing || block)}
                             detail={detail}
                             go={() => { cockpit.location.go(parts.location) }}
                             actions={actions}
                             className={this.props.className}
        />;
    }
}
