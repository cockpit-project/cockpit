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

(function() {
    "use strict";

    var React = require("react");
    var ReactDOM = require("react-dom");
    var PropTypes = require("prop-types");
    var createReactClass = require('create-react-class');

    var cockpitListing = require("cockpit-components-listing.jsx");

    /* Sample tab renderer for listing pattern
     * Shows a caption and the time it was instantiated
     */
    var DemoListingTab = createReactClass({
        propTypes: {
            description: PropTypes.string.isRequired,
        },
        getInitialState: function() {
            return {
                initTime: new Date().toLocaleString(),
            };
        },
        render: function() {
            return (<div>
                <span>This is a listing tab</span><br />
                <span>{this.props.description}</span><br />
                <span>Initialized at: {this.state.initTime}</span>
            </div>
            );
        },
    });

    var showListingDemo = function(rootElement, rootElementSelectable, rootElementEmptyList) {
        var navigateToItem = function(msg) {
            window.alert("navigated to item: " + msg);
        };

        var handleAddClick = function(event) {
            if (event.button !== 0)
                return;

            window.alert('This link could open a dialog to create a new entry');
        };

        var handlePlayClick = function(event) {
            if (event.button !== 0)
                return;

            window.alert('This is a row-specific action');
            event.stopPropagation();
        };

        var tabRenderers = [
            {
                name: 'onlyActive',
                renderer: DemoListingTab,
                data: { description: "Tab should only stay loaded when active" },
                presence: 'onlyActive',
            },
            {
                name: 'default',
                renderer: DemoListingTab,
                data: { description: "standard behavior tab" },
            },
            {
                name: 'always',
                renderer: DemoListingTab,
                data: { description: "Tab should always stay loaded while row is expanded" },
                presence: 'always',
            },
            {
                name: 'loadOnDemand',
                renderer: DemoListingTab,
                data: { description: "Tab is loaded on demand, then stays active until row is collapsed" },
                presence: 'loadOnDemand',
            },
        ];

        var addLink = <a className="pull-right" role="link" tabIndex="0" onClick={handleAddClick}>Add Row</a>;

        var rowAction = {
            element: <button className="btn btn-default btn-control fa fa-play" onClick={handlePlayClick} />,
            tight: true
        };

        // create the listings
        var listing = (
            <cockpitListing.Listing title="Demo Listing Pattern with expandable rows"
                actions={addLink}
                columnTitles={['Name', 'Random', 'IP', 'State']}>
                <cockpitListing.ListingRow
                    columns={ [ { name: 'standard', 'header': true }, 'aoeuaoeu', '127.30.168.10', 'Running' ] }
                    tabRenderers={tabRenderers}
                    navigateToItem={navigateToItem.bind(this, 'frontend')} />
                <cockpitListing.ListingRow
                    columns={ [ { name: "can't navigate", 'header': true }, 'aoeuaoeu', '127.30.168.10', 'Running' ] }
                    tabRenderers={tabRenderers} />
                <cockpitListing.ListingRow
                    columns={ [ { name: "with button", 'header': true }, 'aoeuaoeu', '127.30.168.10', rowAction ] }
                    tabRenderers={tabRenderers} />
                <cockpitListing.ListingRow
                    columns={ [ { name: "initially expanded", 'header': true }, 'aoeuaoeu', '127.30.168.12', rowAction ] }
                    tabRenderers={tabRenderers} initiallyExpanded />
                <cockpitListing.ListingRow
                    columns={ [ { name: 'nothing to expand', 'header': true }, 'some text', '127.30.168.11', 'some state' ] } />
            </cockpitListing.Listing>
        );
        ReactDOM.render(listing, rootElement);

        listing = (
            <cockpitListing.Listing title="Demo Listing Pattern with selectable rows"
                actions={addLink}
                columnTitles={['Name', 'Random', 'IP', 'State']}>
                <cockpitListing.ListingRow
                    columns={ [ { name: 'selected by default', 'header': true }, 'aoeuaoeu', '127.30.168.10', 'Running' ] }
                    selected />
                <cockpitListing.ListingRow
                    columns={ [ { name: "not selected by default", 'header': true }, 'aoeuaoeu', '127.30.168.11', 'Running' ] }
                    selected={false} />
                <cockpitListing.ListingRow
                    columns={ [ { name: "no selected entry", 'header': true }, 'aoeuaoeu', '127.30.168.12', rowAction ] } />
            </cockpitListing.Listing>
        );
        ReactDOM.render(listing, rootElementSelectable);

        var emptyListing = <cockpitListing.Listing title="Demo Empty Listing Pattern" emptyCaption="No Entries" />;
        ReactDOM.render(emptyListing, rootElementEmptyList);
    };

    module.exports = {
        demo: showListingDemo,
    };
}());
