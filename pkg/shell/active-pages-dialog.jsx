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

var React = require("react");
var createReactClass = require('create-react-class');

var cockpit = require("cockpit");
var _ = cockpit.gettext;

var listingPattern = require("cockpit-components-listing.jsx");
var Listing = listingPattern.Listing;
var ListingRow = listingPattern.ListingRow;

/* Dialog body to show active Cockpit pages
 * Props:
 *  - iframes          iframe elements on page to list
 *  - selectionChanged callback when the select state changed, parameters: frame object, new value
 */
var ActivePagesDialogBody = createReactClass({
    render: function() {
        var self = this;
        var frames = self.props.iframes.map(function(frame) {
            var badge;
            if (frame.visible)
                badge = <span className="badge pull-right">{_("active")}</span>;
            var columns = [
                { name: frame.displayName, header: frame.visible },
                badge,
            ];
            var selectCallback;
            if (self.props.selectionChanged)
                selectCallback = self.props.selectionChanged.bind(self, frame);
            return (
                <ListingRow columns={columns}
                    rowId={frame.name}
                    selected={frame.selected}
                    selectChanged={selectCallback}
                />
            );
        });

        return (
            <div className="modal-body">
                <Listing emptyCaption={ _("There are currently no active pages") }>
                    {frames}
                </Listing>
            </div>
        );
    }
});

module.exports = ActivePagesDialogBody;
