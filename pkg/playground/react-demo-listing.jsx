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
define([
    "base1/react",
    "base1/cockpit-components-listing",
], function(React, cockpitListing) {

"use strict";

/* Sample tab renderer for listing pattern
 * Shows a caption and the time it was instantiated
 */
var DemoListingTab = React.createClass({
    propTypes: {
        description: React.PropTypes.string.isRequired,
    },
    getInitialState: function() {
        return {
            initTime: new Date().toLocaleString(),
        };
    },
    render: function() {
        return (<div>
                    <span>This is a listing tab</span><br/>
                    <span>{this.props.description}</span><br/>
                    <span>Initialized at: {this.state.initTime}</span>
                </div>
               );
    },
});

var showListingDemo = function(rootElement) {
    var navigateToItem = function(msg) {
        window.alert("navigated to item: " + msg);
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

    // create the dialog
    var listing = (
        <cockpitListing.Listing title="Demo Listing Pattern with expandable rows">
             <cockpitListing.ListingRow
                 columns={ [ { name: 'standard', 'header': true }, 'aoeuaoeu', '127.30.168.10', 'Running' ] }
                 tabRenderers={tabRenderers}
                 navigateToItem={navigateToItem.bind(this, 'frontend')}/>
             <cockpitListing.ListingRow
                 columns={ [ { name: "can't navigate", 'header': true }, 'aoeuaoeu', '127.30.168.10', 'Running' ] }
                 tabRenderers={tabRenderers}/>
         </cockpitListing.Listing>
    );
    React.render(listing, rootElement);
};

return {
    demo: showListingDemo,
};

});
