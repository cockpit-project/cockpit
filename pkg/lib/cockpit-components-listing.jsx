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

import PropTypes from 'prop-types';
import React from 'react';
import './listing.less';

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
 * selected optional: true if the item is selected, false if it unselected but selectable,
 *                    not set if it is not selectable. Can't be set if row has navigation or expansion
 * initiallyExpanded optional: the entry will be initially rendered as expanded, but then behaves normally
 * expandChanged optional: callback will be used if the row is either expanded or collapsed passing single `isExpanded` boolean argument
 * extraClass optional: CSS class name(s) to be added to the main <div> of the component
 */
export class ListingRow extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            expanded: this.props.initiallyExpanded, // show expanded view if true, otherwise one line compact
            activeTab: this.props.initiallyActiveTab ? this.props.initiallyActiveTab : 0, // currently active tab in expanded mode, defaults to first tab
            loadedTabs: {}, // which tabs were already loaded - this is important for 'loadOnDemand' setting
            // contains tab indices
            selected: this.props.selected, // whether the current row is selected
        };
        this.handleNavigateClick = this.handleNavigateClick.bind(this);
        this.handleExpandClick = this.handleExpandClick.bind(this);
        this.handleSelectClick = this.handleSelectClick.bind(this);
        this.handleTabClick = this.handleTabClick.bind(this);
    }

    handleNavigateClick(e) {
        // only consider primary mouse button
        if (!e || e.button !== 0)
            return;
        this.props.navigateToItem();
    }

    handleExpandClick(e) {
        // only consider primary mouse button
        if (!e || e.button !== 0)
            return;

        let willBeExpanded = !this.state.expanded && this.props.tabRenderers.length > 0;
        this.setState({ expanded: willBeExpanded });

        let loadedTabs = {};
        // unload all tabs if not expanded
        if (willBeExpanded) {
            // see if we should preload some tabs
            let tabIdx;
            let tabPresence;
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

        this.setState({ loadedTabs: loadedTabs });

        this.props.expandChanged && this.props.expandChanged(willBeExpanded);

        e.stopPropagation();
        e.preventDefault();
    }

    handleSelectClick(e) {
        // only consider primary mouse button
        if (!e || e.button !== 0)
            return;

        let selected = !this.state.selected;
        this.setState({ selected: selected });

        if (this.props.selectChanged)
            this.props.selectChanged(selected);

        e.stopPropagation();
        e.preventDefault();
    }

    handleTabClick(tabIdx, e) {
        // only consider primary mouse button
        if (!e || e.button !== 0)
            return;
        let prevTab = this.state.activeTab;
        let prevTabPresence = 'default';
        let loadedTabs = this.state.loadedTabs;
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
    }

    render() {
        let self = this;
        // only enable navigation if a function is provided and the row isn't expanded (prevent accidental navigation)
        let allowNavigate = !!this.props.navigateToItem && !this.state.expanded;

        let headerEntries = this.props.columns.map((itm, index) => {
            if (typeof itm === 'string' || typeof itm === 'number' || itm === null || itm === undefined || itm instanceof String || React.isValidElement(itm))
                return (<td key={index}>{itm}</td>);
            else if ('header' in itm && itm.header)
                return (<th key={index}>{itm.name}</th>);
            else if ('tight' in itm && itm.tight)
                return (<td key={index} className="listing-ct-actions">{itm.name || itm.element}</td>);
            else
                return (<td key={index}>{itm.name}</td>);
        });

        let allowExpand = (this.props.tabRenderers.length > 0);
        let expandToggle;
        if (allowExpand) {
            expandToggle = <td key="expandToggle" className="listing-ct-toggle" onClick={ allowNavigate ? this.handleExpandClick : undefined }>
                <i className="fa fa-fw" />
            </td>;
        } else {
            expandToggle = <td key="expandToggle-empty" className="listing-ct-toggle" />;
        }

        let listingItemClasses = ["listing-ct-item"];
        if (!allowNavigate)
            listingItemClasses.push("listing-ct-nonavigate");
        if (!allowExpand)
            listingItemClasses.push("listing-ct-noexpand");

        let allowSelect = !(allowNavigate || allowExpand) && (this.state.selected !== undefined);
        let clickHandler;
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

        let extraClass = this.props.extraClass;
        if (extraClass) {
            listingItemClasses.push(extraClass);
        }

        let listingItem = (
            <tr data-row-id={ this.props.rowId }
                className={ listingItemClasses.join(' ') }
                onClick={clickHandler}>
                {expandToggle}
                {headerEntries}
            </tr>
        );

        if (this.state.expanded) {
            let links = this.props.tabRenderers.map((itm, idx) => {
                return (
                    <li key={idx} className={ (idx === self.state.activeTab) ? "active" : ""} >
                        <a href="#" tabIndex="0" onClick={ self.handleTabClick.bind(self, idx) }>{itm.name}</a>
                    </li>
                );
            });
            let tabs = [];
            let tabIdx;
            let Renderer;
            let rendererData;
            let row;
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

            let listingDetail;
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
                        <td colSpan={ headerEntries.length + (expandToggle ? 1 : 0) }>
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
                    <tr className="listing-ct-panel" />
                </tbody>
            );
        }
    }
}

ListingRow.defaultProps = {
    tabRenderers: [],
    selected: undefined,
    navigateToItem: null,
    extraClass: null
};

ListingRow.propTypes = {
    rowId: PropTypes.string,
    columns: PropTypes.array.isRequired,
    tabRenderers: PropTypes.array,
    navigateToItem: PropTypes.func,
    listingDetail: PropTypes.node,
    listingActions: PropTypes.node,
    selectChanged: PropTypes.func,
    selected: PropTypes.bool,
    initiallyExpanded: PropTypes.bool,
    expandChanged: PropTypes.func,
    initiallyActiveTab: PropTypes.number,
    extraClass: PropTypes.string
};
/* Implements a PatternFly 'List View' pattern
 * https://www.patternfly.org/list-view/
 * Properties (all optional):
 * - title
 * - fullWidth: set width to 100% of parent, defaults to true
 * - compact: reduce spacing for each cell, defaults to false
 * - emptyCaption: header caption to show if list is empty
 * - columnTitles: array of column titles, as strings
 * - columnTitleClick: callback for clicking on column title (for sorting)
 *                     receives the column index as argument
 * - actions: additional listing-wide actions (displayed next to the list's title)
 */
export const Listing = (props) => {
    let bodyClasses = ["listing", "listing-ct"];
    if (props.fullWidth)
        bodyClasses.push("listing-ct-wide");
    if (props.compact)
        bodyClasses.push("listing-ct-compact");
    let headerClasses;
    let headerRow;
    if (!props.children || props.children.length === 0) {
        headerClasses = "listing-ct-empty";
        headerRow = <tr><td>{props.emptyCaption}</td></tr>;
    } else if (props.columnTitles.length) {
        headerRow = (
            <tr>
                <th key="empty" className="listing-ct-toggle" />
                { props.columnTitles.map((title, index) => {
                    let clickHandler = null;
                    if (props.columnTitleClick)
                        clickHandler = function() { props.columnTitleClick(index) };
                    return <th key={index} onClick={clickHandler}>{title}</th>;
                }) }
            </tr>
        );
    } else {
        headerRow = <tr />;
    }
    let caption;
    if (props.title || (props.actions && props.actions.length > 0))
        caption = <caption className="cockpit-caption">{props.title}{props.actions}</caption>;

    return (
        <table className={ bodyClasses.join(" ") }>
            {caption}
            <thead className={headerClasses}>
                {headerRow}
            </thead>
            {props.children}
        </table>
    );
};

Listing.defaultProps = {
    title: '',
    fullWidth: true,
    compact: false,
    emptyCaption: '',
    columnTitles: [],
    actions: []
};

Listing.propTypes = {
    title: PropTypes.string,
    fullWidth: PropTypes.bool,
    compact: PropTypes.bool,
    emptyCaption: PropTypes.node,
    columnTitles: PropTypes.arrayOf(
        PropTypes.oneOfType([
            PropTypes.string,
            PropTypes.element,
        ])),
    columnTitleClick: PropTypes.func,
    actions: PropTypes.node
};
