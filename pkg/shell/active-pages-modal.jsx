/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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
import { ListingTable } from "cockpit-components-table.jsx";
import { Button, Label, Split, SplitItem, Modal } from '@patternfly/react-core';

const _ = cockpit.gettext;

export class ActivePagesDialog extends React.Component {
    constructor(props) {
        super(props);

        const frames = [];
        for (const address in props.frames.iframes) {
            for (const component in props.frames.iframes[address]) {
                const iframe = props.frames.iframes[address][component];
                frames.push({
                    frame: iframe,
                    component: component,
                    address: address,
                    name: iframe.getAttribute("name"),
                    active: iframe.getAttribute("data-active") === 'true',
                    selected: iframe.getAttribute("data-active") === 'true',
                    displayName: address === "localhost" ? "/" + component : address + ":/" + component
                });
            }
        }

        // sort the frames by displayName, active ones first
        frames.sort(function(a, b) {
            return (a.active ? -2 : 0) + (b.active ? 2 : 0) +
                   ((a.displayName < b.displayName) ? -1 : 0) + ((b.displayName < a.displayName) ? 1 : 0);
        });

        this.state = { frames: frames };

        this.onRemove = this.onRemove.bind(this);
    }

    onRemove() {
        this.state.frames.forEach(element => {
            if (element.selected)
                this.props.frames.remove(element.host, element.component);
        });
        this.props.onClose();
    }

    render() {
        const frames = this.state.frames.map(frame => {
            const columns = [{
                title: <Split>
                    <SplitItem isFilled>
                        {frame.displayName}
                    </SplitItem>
                    <SplitItem>
                        {frame.active && <Label color="blue">{_("active")}</Label>}
                    </SplitItem>
                </Split>,
            }];
            return ({
                props: {
                    key: frame.name,
                    'data-row-id': frame.name
                },
                columns,
                selected: frame.selected,
            });
        });

        return (
            <Modal isOpen position="top" variant="small"
                   id="active-pages-dialog"
                   onClose={this.props.onClose}
                   title={_("Active pages")}
                   footer={<>
                       <Button variant='primary' onClick={this.onRemove}>{_("Close selected pages")}</Button>
                       <Button variant='link' onClick={this.props.onClose}>{_("Cancel")}</Button>
                   </>}
            >
                <ListingTable showHeader={false}
                              columns={[{ title: _("Page name") }]}
                              aria-label={_("Active pages")}
                              emptyCaption={ _("There are currently no active pages") }
                              onSelect={(_event, isSelected, rowIndex) => {
                                  const frames = [...this.state.frames];
                                  frames[rowIndex].selected = isSelected;
                                  this.setState({ frames });
                              }}
                              rows={frames} />
            </Modal>
        );
    }
}
