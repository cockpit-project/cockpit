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
    "./react",
], function(React) {

    "use strict";

    /* entry for an alert in the listing, can be expanded (with details) or standard
     * columns list of columns to show in the header
     *     columns to show, can be a string, react component or object with { name: 'name', 'header': false }
     *     'header' (or if simple string) defaults to false
     *     in case 'header' is true, <th> is used for the entries, otherwise <td>
     * tabRenderers optional: list of tab renderers for inline expansion, array of objects with
     *     - name tab name (has to be unique in the entry, used as react key)
     *     - renderer react component
     *     - data render data passed to the tab renderer
     *     - presence 'always', 'onlyActive', 'loadOnDemand', default: 'loadOnDemand'
     *         - 'always' once a row is expanded, this tab is always rendered, but invisible if not active
     *         - 'onlyActive' the tab is only rendered when active
     *         - 'loadOnDemand' the tab is first rendered when it becomes active, then follows 'always' behavior
     *     if tabRenderers isn't set, item can't be expanded inline
     * navigateToItem optional: callback triggered when a row is clicked, pattern suggests navigation
     *     to view expanded item details, if not set, navigation isn't available
     * listingDetail optional: text rendered next to action buttons, similar style to the tab headers
     * listingActions optional: buttons that are presented as actions for the expanded item
     */
    var ListingRow = React.createClass({
        propTypes: {
            columns: React.PropTypes.array.isRequired,
            tabRenderers: React.PropTypes.array,
            navigateToItem: React.PropTypes.func,
        },
        getDefaultProps: function () {
            return {
                tabRenderers: [],
                navigateToItem: null,
            };
        },
        getInitialState: function() {
            return {
                expanded: false, // show expanded view if true, otherwise one line compact
                activeTab: 0,    // currently active tab in expanded mode, defaults to first tab
                loadedTabs: {},  // which tabs were already loaded - this is important for 'loadOnDemand' setting
                                 // contains tab indices
            };
        },
        handleNavigateClick: function(e) {
            // only consider primary mouse button
            if (!e || e.button !== 0)
                return;
            this.props.navigateToItem();
        },
        handleExpandClick: function(e) {
            // only consider primary mouse button
            if (!e || e.button !== 0)
                return;

            var willBeExpanded = !this.state.expanded;
            this.setState( { expanded: willBeExpanded });

            var loadedTabs = {};
            // unload all tabs if not expanded
            if (willBeExpanded) {
                // see if we should preload some tabs
                var tabIdx;
                var tabPresence;
                for (tabIdx = 0; tabIdx < this.props.tabRenderers.length; tabIdx++) {
                    if ('presence' in this.props.tabRenderers[tabIdx])
                        tabPresence = this.props.tabRenderers[tabIdx].presence;
                    else
                        tabPresence = 'default';
                    // the active tab is covered by separate logic
                    if (tabPresence == 'always')
                        loadedTabs[tabIdx] = true;
                }
                // ensure the active tab is loaded
                loadedTabs[this.state.activeTab] = true;
            }

            this.setState( { loadedTabs: loadedTabs });

            e.stopPropagation();
            e.preventDefault();
        },
        handleTabClick: function(tabIdx, e) {
            // only consider primary mouse button
            if (!e || e.button !== 0)
                return;
            var prevTab = this.state.activeTab;
            var prevTabPresence = 'default';
            var loadedTabs = this.state.loadedTabs;
            if (prevTab !== tabIdx) {
                // see if we need to unload the previous tab
                if ('presence' in this.props.tabRenderers[prevTab])
                    prevTabPresence = this.props.tabRenderers[prevTab].presence;

                if (prevTabPresence == 'onlyActive')
                    delete loadedTabs[prevTab];

                // ensure the new tab is loaded and update state
                loadedTabs[tabIdx] = true;
                this.setState({ loadedTabs: loadedTabs, activeTab: tabIdx });
            }
            e.stopPropagation();
            e.preventDefault();
        },
        render: function() {
            var self = this;
            // only enable navigation if a function is provided and the row isn't expanded (prevnt accidental navigation)
            var allow_navigate = !!this.props.navigateToItem && !this.state.expanded;
            var bodyProps = { className: '', onClick: this.handleClick };
            var count_display = null;

            var header_entries = this.props.columns.map(function(itm) {
                if (typeof itm === 'string' || itm === null || itm instanceof String || React.isValidElement(itm))
                    return (<td>{itm}</td>);
                else if ('header' in itm && itm.header)
                    return (<th>{itm.name}</th>);
                else
                    return (<td>{itm.name}</td>);
            });

            var expand_toggle = null;
            if (this.props.tabRenderers.length > 0) {
                expand_toggle = <td className="listing-ct-toggle" onClick={ allow_navigate?this.handleExpandClick:undefined }>
                                    <i className="fa fa-fw"></i>
                                </td>;
            }
            var listing_item_classes = ["listing-ct-item"];
            if (!allow_navigate)
                listing_item_classes.push("listing-ct-nonavigate");
            var listing_item = (
                <tr className={ listing_item_classes.join(' ') }
                    onClick={ allow_navigate?this.handleNavigateClick:this.handleExpandClick }>
                    {expand_toggle}
                    {header_entries}
                </tr>
            );

            if (this.state.expanded) {
                if (this.props.count > 1)
                    count_display = <span className="pull-right">{ this.props.count + " occurrences"}</span>;
                var links = this.props.tabRenderers.map(function(itm, idx) {
                    return (
                        <li key={idx} className={ (idx === self.state.activeTab) ? "active" : ""} >
                            <a href="#" onClick={ self.handleTabClick.bind(self, idx) }>{itm.name}</a>
                        </li>
                    );
                });
                var tabs = [];
                var tabIdx;
                var Renderer;
                var renderer_data;
                var row;
                for (tabIdx = 0; tabIdx < this.props.tabRenderers.length; tabIdx++) {
                    Renderer = this.props.tabRenderers[tabIdx].renderer;
                    renderer_data = this.props.tabRenderers[tabIdx].data;
                    if (tabIdx !== this.state.activeTab && !(tabIdx in this.state.loadedTabs))
                        continue;
                    row = <Renderer key={ this.props.tabRenderers[tabIdx].name } hidden={ (tabIdx !== this.state.activeTab) } {...renderer_data} />;
                    if (tabIdx === this.state.activeTab)
                        tabs.push(<div className="listing-ct-body" key={tabIdx}>{row}</div>);
                    else
                        tabs.push(<div className="listing-ct-body" key={tabIdx} hidden>{row}</div>);
                }

                var listingDetail;
                if ('listingDetail' in this.props) {
                    listingDetail = (
                        <span className="listing-ct-caption">
                            {this.props.listingDetail}
                        </span>
                    );
                }

                return (
                    <tbody className="open">
                        {listing_item}
                        <tr className="listing-ct-panel">
                            <td colSpan={ header_entries.length + (expand_toggle?1:0) }>
                                <div className="listing-ct-head">
                                    <div className="listing-ct-actions">
                                        {listingDetail}
                                        {this.props.listingActions}
                                    </div>
                                    <ul className="nav nav-tabs nav-tabs-pf">
                                        {links}
                                    </ul>
                                </div>
                                {tabs}
                            </td>
                        </tr>
                    </tbody>
                );
            } else {
                return (
                    <tbody>
                        {listing_item}
                        <tr className="listing-ct-panel"/>
                    </tbody>
                );
            }
        }
    });

    /* Implements a PatternFly 'List View' pattern
     * https://www.patternfly.org/list-view/
     * Properties:
     * - title
     * - fullWidth optional: set width to 100% of parent, defaults to true
     * - emptyCaption header caption to show if list is empty, defaults to "No entries"
     */
    var Listing = React.createClass({
        propTypes: {
            title: React.PropTypes.string.isRequired,
            fullWidth: React.PropTypes.bool,
            emptyCaption: React.PropTypes.string.isRequired,
        },
        getDefaultProps: function () {
            return {
                fullWidth: true,
            };
        },
        render: function() {
            var bodyClasses = ["listing", "listing-ct"];
            if (this.props.fullWidth)
                bodyClasses.push("listing-ct-wide");
            var headerClasses;
            var headerRow = <tr/>;
            if (!this.props.children || this.props.children.length === 0) {
                headerClasses = "listing-ct-empty";
                headerRow = <tr><td>{this.props.emptyCaption}</td></tr>;
            }
            return (
                <table className={ bodyClasses.join(" ") }>
                    <caption className="cockpit-caption">{this.props.title}</caption>
                    <thead className={headerClasses}>
                        {headerRow}
                    </thead>
                    {this.props.children}
                </table>
            );
        },
    });

    return {
        ListingRow: ListingRow,
        Listing: Listing,
    };

});
