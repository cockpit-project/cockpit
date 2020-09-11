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

import React from "react";

import cockpit from "cockpit";

import { ListingTable } from "cockpit-components-table.jsx";

const _ = cockpit.gettext;

/* Dialog body to show active Cockpit pages
 * Props:
 *  - iframes          iframe elements on page to list
 *  - selectionChanged callback when the select state changed, parameters: frame object, new value
 */
export class ActivePagesDialogBody extends React.Component {
    constructor(props) {
        super(props);

        this.state = { iframes: this.props.iframes };
    }

    render() {
        var self = this;
        var frames = self.state.iframes.map(function(frame) {
            var columns = [{
                title: <>{frame.displayName}{frame.visible && <span className="badge active pull-right">{_("active")}</span>}</>,
            }];
            return ({
                props: { key: frame.name, frame },
                columns,
                rowId: frame.name,
                selected: frame.selected,
            });
        });

        return (
            <ListingTable showHeader={false}
                          columns={[{ title: _("Page name") }]}
                          aria-label={_("Active pages")}
                          emptyCaption={ _("There are currently no active pages") }
                          onSelect={(_event, isSelected, rowIndex, rowData) => {
                              const frame = rowData.props.frame;
                              const iframes = [...this.state.iframes];
                              iframes[rowIndex].selected = isSelected;
                              this.setState({ iframes });
                              self.props.selectionChanged(frame, isSelected);
                          }}
                          rows={frames} />
        );
    }
}
