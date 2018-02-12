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

"use strict";

var React = require('react');

require('./listing.less');

/* entry for an alert in the listing, can be expanded (with details) or standard
 * rowId optional: an identifier for the row which will be set as "data-row-id" attribute on the <tr>
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
 * selectChanged optional: callback will be used when the "selected" state changes
 * selected optional: true if the item is selected, can't be true if row has navigation or expansion
 * initiallyExpanded optional: the entry will be initially rendered as expanded, but then behaves normally
 * expandChanged optional: callback will be used if the row is either expanded or collapsed passing single `isExpanded` boolean argument
 */
var ListingRow = React.createClass({
    propTypes: {
        rowId: React.PropTypes.string,
        columns: React.PropTypes.array.isRequired,
        tabRenderers: React.PropTypes.array,
        navigateToItem: React.PropTypes.func,
        listingDetail: React.PropTypes.node,
        listingActions: React.PropTypes.arrayOf(React.PropTypes.node),
        selectChanged: React.PropTypes.func,
        selected: React.PropTypes.bool,
        initiallyExpanded: React.PropTypes.bool,
        expandChanged: React.PropTypes.func,
        initiallyActiveTab: React.PropTypes.bool,
    },
    getDefaultProps: function () {
        return {
            tabRenderers: [],
            navigateToItem: null,
        };
    },
    getInitialState: function() {
        return {
            expanded: this.props.initiallyExpanded, // show expanded view if true, otherwise one line compact
            activeTab: this.props.initiallyActiveTab ? this.props.initiallyActiveTab : 0,    // currently active tab in expanded mode, defaults to first tab
            loadedTabs: {},  // which tabs were already loaded - this is important for 'loadOnDemand' setting
                             // contains tab indices
            selected: this.props.selected, // whether the current row is selected
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

        var willBeExpanded = !this.state.expanded && this.props.tabRenderers.length > 0;
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

        this.props.expandChanged && this.props.expandChanged(willBeExpanded);

        e.stopPropagation();
        e.preventDefault();
    },
    handleSelectClick: function(e) {
        // only consider primary mouse button
        if (!e || e.button !== 0)
            return;

        var selected = !this.state.selected;
        this.setState( { selected: selected });

        if (this.props.selectChanged)
            this.props.selectChanged(selected);

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
        // only enable navigation if a function is provided and the row isn't expanded (prevent accidental navigation)
        var allowNavigate = !!this.props.navigateToItem && !this.state.expanded;

        var headerEntries = this.props.columns.map(function(itm) {
            if (typeof itm === 'string' || typeof itm === 'number' || itm === null || itm === undefined || itm instanceof String || React.isValidElement(itm))
                return (<td>{itm}</td>);
            else if ('header' in itm && itm.header)
                return (<th>{itm.name}</th>);
            else if ('tight' in itm && itm.tight)
                return (<td className="listing-ct-actions">{itm.name || itm.element}</td>);
            else
                return (<td>{itm.name}</td>);
        });

        var allowExpand = (this.props.tabRenderers.length > 0);
        var expandToggle;
        if (allowExpand) {
            expandToggle = <td className="listing-ct-toggle" onClick={ allowNavigate?this.handleExpandClick:undefined }>
                               <i className="fa fa-fw"></i>
                           </td>;
        } else {
            expandToggle = <td className="listing-ct-toggle"></td>;
        }

        var listingItemClasses = ["listing-ct-item"];
        if (!allowNavigate)
            listingItemClasses.push("listing-ct-nonavigate");
        if (!allowExpand)
            listingItemClasses.push("listing-ct-noexpand");

        var allowSelect = !(allowNavigate || allowExpand) && (this.state.selected !== undefined);
        var clickHandler;
        if (allowSelect) {
            clickHandler = this.handleSelectClick;
            if (this.state.selected)
                listingItemClasses.push("listing-ct-selected");
        } else {
            if (allowNavigate)
                clickHandler = this.handleNavigateClick;
            else
                clickHandler = this.handleExpandClick;
        }

        var listingItem = (
            <tr data-row-id={ this.props.rowId }
                className={ listingItemClasses.join(' ') }
                onClick={clickHandler}>
                {expandToggle}
                {headerEntries}
            </tr>
        );

        if (this.state.expanded) {
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
            var rendererData;
            var row;
            for (tabIdx = 0; tabIdx < this.props.tabRenderers.length; tabIdx++) {
                Renderer = this.props.tabRenderers[tabIdx].renderer;
                rendererData = this.props.tabRenderers[tabIdx].data;
                if (tabIdx !== this.state.activeTab && !(tabIdx in this.state.loadedTabs))
                    continue;
                row = <Renderer key={ this.props.tabRenderers[tabIdx].name } hidden={ (tabIdx !== this.state.activeTab) } {...rendererData} />;
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
                    {listingItem}
                    <tr className="listing-ct-panel">
                        <td colSpan={ headerEntries.length + (expandToggle?1:0) }>
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
                    {listingItem}
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
 * - columnTitles: array of column titles, as strings
 * - columnTitleClick: optional callback for clicking on column title (for sorting)
 *                     receives the column index as argument
 * - actions: additional listing-wide actions (displayed next to the list's title)
 */
var Listing = React.createClass({
    propTypes: {
        title: React.PropTypes.string.isRequired,
        fullWidth: React.PropTypes.bool,
        emptyCaption: React.PropTypes.string.isRequired,
        columnTitles: React.PropTypes.arrayOf(React.PropTypes.string),
        columnTitleClick: React.PropTypes.func,
        actions: React.PropTypes.arrayOf(React.PropTypes.node)
    },
    getDefaultProps: function () {
        return {
            fullWidth: true,
            columnTitles: [],
            actions: []
        };
    },
    render: function() {
        var self = this;
        var bodyClasses = ["listing", "listing-ct"];
        if (this.props.fullWidth)
            bodyClasses.push("listing-ct-wide");
        var headerClasses;
        var headerRow;
        var selectableRows;
        if (!this.props.children || this.props.children.length === 0) {
            headerClasses = "listing-ct-empty";
            headerRow = <tr><td>{this.props.emptyCaption}</td></tr>;
        } else if (this.props.columnTitles.length) {
            // check if any of the children are selectable
            selectableRows = false;
            this.props.children.forEach(function(r) {
                if (r.props.selected !== undefined)
                    selectableRows = true;
            });

            if (selectableRows) {
                // now make sure that if one is set, it's available on all items
                this.props.children.forEach(function(r) {
                    if (r.props.selected === undefined)
                        r.props.selected = false;
                });
            }

            headerRow = (
                <tr>
                    <th className="listing-ct-toggle"></th>
                    { this.props.columnTitles.map(function (title, index) {
                        var clickHandler = null;
                        if (self.props.columnTitleClick)
                            clickHandler = function() { self.props.columnTitleClick(index) };
                        return <th onClick={clickHandler}>{title}</th>;
                    }) }
                </tr>
            );
        } else {
           headerRow = <tr/>
        }
        var caption;
        if (this.props.title || (this.props.actions && this.props.actions.length > 0))
            caption = <caption className="cockpit-caption">{this.props.title}{this.props.actions}</caption>;

        return (
            <table className={ bodyClasses.join(" ") }>
                {caption}
                <thead className={headerClasses}>
                    {headerRow}
                </thead>
                {this.props.children}
            </table>
        );
    },
});

module.exports = {
    ListingRow: ListingRow,
    Listing: Listing,
};
