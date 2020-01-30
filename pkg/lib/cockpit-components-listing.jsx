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
import './listing.scss';

import { ListingPanel } from './cockpit-components-listing-panel.jsx';

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
 *                    not set if it is not selectable. If row has navigation or expansion the selected can be used
 *                    only with addCheckbox.
 * initiallyExpanded optional: the entry will be initially rendered as expanded, but then behaves normally
 * expandChanged optional: callback will be used if the row is either expanded or collapsed passing single `isExpanded` boolean argument
 * addCheckbox optional: if set a checkbox will appear in the start of the row and the selectChanged
 *                       callback can be used to track row's checked status. Note that rows with checkboxes can't
 *                       be selected outside of the checkbox.
 * simpleBody optional: if set the expansion will just contain this simple body without tabs,
 *                      this does not work well with tabRenderers.
 */
export class ListingRow extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            expanded: this.props.initiallyExpanded, // show expanded view if true, otherwise one line compact
            // contains tab indices
            selected: this.props.selected, // whether the current row is selected
        };
        this.handleNavigateClick = this.handleNavigateClick.bind(this);
        this.handleExpandClick = this.handleExpandClick.bind(this);
        this.handleSelectClick = this.handleSelectClick.bind(this);
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

        const willBeExpanded = !this.state.expanded && (this.props.tabRenderers.length > 0 || this.props.simpleBody);
        this.setState({ expanded: willBeExpanded });

        this.props.expandChanged && this.props.expandChanged(willBeExpanded);

        e.stopPropagation();
        e.preventDefault();
    }

    handleSelectClick(e) {
        // only consider primary mouse button
        // Rows which enable checkboxes don't have selectable rows outside from the checkbox
        if (!e || (e.button !== 0 && e.target.type != 'checkbox'))
            return;

        if (this.props.addCheckbox && e.target.type != 'checkbox')
            return;

        const selected = !this.state.selected;
        this.setState({ selected: selected });

        if (this.props.selectChanged)
            this.props.selectChanged(selected);

        e.stopPropagation();
    }

    render() {
        // only enable navigation if a function is provided and the row isn't expanded (prevent accidental navigation)
        const allowNavigate = !!this.props.navigateToItem && !this.state.expanded;

        const headerEntries = this.props.columns.map((itm, index) => {
            if (typeof itm === 'string' || typeof itm === 'number' || itm === null || itm === undefined || itm instanceof String || React.isValidElement(itm))
                return (<td key={index}>{itm}</td>);
            else if ('header' in itm && itm.header)
                return (<th key={index}>{itm.name}</th>);
            else if ('tight' in itm && itm.tight)
                return (<td key={index} className="listing-ct-actions">{itm.name || itm.element}</td>);
            else
                return (<td key={index}>{itm.name}</td>);
        });

        const allowExpand = (this.props.tabRenderers.length > 0 || this.props.simpleBody);
        let expandToggle;
        if (allowExpand) {
            expandToggle = <td key="expandToggle" className="listing-ct-toggle">
                <button className="pf-c-button pf-m-plain" type="button" aria-label="expand row" onClick={ allowNavigate ? this.handleExpandClick : undefined }><i className="fa fa-fw" /></button>
            </td>;
        } else {
            expandToggle = <td key="expandToggle-empty" className="listing-ct-toggle" />;
        }

        let listingItemClasses = ["listing-ct-item"];

        if (this.props.extraClasses)
            listingItemClasses = listingItemClasses.concat(this.props.extraClasses);

        if (!allowNavigate)
            listingItemClasses.push("listing-ct-nonavigate");
        if (!allowExpand)
            listingItemClasses.push("listing-ct-noexpand");

        const allowSelect = !(allowNavigate || allowExpand) && (this.state.selected !== undefined);
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

        let checkboxItem;
        if (this.props.addCheckbox) {
            checkboxItem = <td key="checkboxItem" className="listing-ct-toggle">
                <input type='checkbox' checked={this.state.selected || false} onChange={this.handleSelectClick} />
            </td>;
        }

        const listingItem = (
            <tr data-row-id={ this.props.rowId }
                className={ listingItemClasses.join(' ') }
                onClick={clickHandler}>
                {expandToggle}
                {checkboxItem}
                {headerEntries}
            </tr>
        );

        return (
            <tbody className={this.state.expanded ? 'open' : ''}>
                {listingItem}
                <tr className="ct-listing-panel">
                    <td colSpan={ headerEntries.length + (expandToggle ? 1 : 0) + (this.props.addCheckbox ? 1 : 0) }>
                        {this.state.expanded && <ListingPanel tabRenderers={this.props.tabRenderers}
                                                              simpleBody={this.props.simpleBody}
                                                              initiallyActiveTab={this.props.initiallyActiveTab}
                                                              listingActions={this.props.listingActions}
                                                              listingDetail={this.props.listingDetail} />}
                    </td>
                </tr>
            </tbody>
        );
    }
}

ListingRow.defaultProps = {
    tabRenderers: [],
    selected: undefined,
    navigateToItem: null,
    addCheckbox: false,
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
    addCheckbox: PropTypes.bool,
    initiallyExpanded: PropTypes.bool,
    expandChanged: PropTypes.func,
    initiallyActiveTab: PropTypes.number,
    extraClasses: PropTypes.array,
    simpleBody: PropTypes.node,
};
/* Implements a PatternFly 'List View' pattern
 * https://www.patternfly.org/v3/pattern-library/content-views/list-view/index.html
 * Properties (all optional):
 * - title
 * - fullWidth: set width to 100% of parent, defaults to true
 * - emptyCaption: header caption to show if list is empty
 * - columnTitles: array of column titles, as strings
 * - columnTitleClick: callback for clicking on column title (for sorting)
 *                     receives the column index as argument
 * - hasCheckbox: true if listing rows have checkboxes
 * - actions: additional listing-wide actions (displayed next to the list's title)
 */
export const Listing = (props) => {
    const bodyClasses = ["listing", "listing-ct"];
    if (props.fullWidth)
        bodyClasses.push("listing-ct-wide");
    let headerClasses;
    let headerRow;
    if (!props.children || props.children.length === 0) {
        headerClasses = "listing-ct-empty";
        headerRow = <tr><td>{props.emptyCaption}</td></tr>;
    } else if (props.columnTitles.length) {
        headerRow = (
            <tr>
                <th key="empty" className="listing-ct-toggle" />
                { props.hasCheckbox && <th key="empty-checkbox" className="listing-ct-toggle" /> }
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
    let heading;
    if (props.title || (props.actions && props.actions.length > 0))
        heading = (
            <header>
                {props.title && <h3 className="listing-ct-heading" id="listing-ct-heading">{props.title}</h3>}
                {props.actions && <div className="listing-ct-actions">
                    {props.actions}
                </div>}
            </header>
        );

    return (
        <section className="ct-listing">
            {heading}
            <table aria-labelledby={heading && "listing-ct-heading"} className={ bodyClasses.join(" ") }>
                <thead className={headerClasses}>
                    {headerRow}
                </thead>
                {props.children}
            </table>
        </section>
    );
};

Listing.defaultProps = {
    title: '',
    fullWidth: true,
    emptyCaption: '',
    columnTitles: [],
    actions: []
};

Listing.propTypes = {
    title: PropTypes.string,
    fullWidth: PropTypes.bool,
    emptyCaption: PropTypes.node,
    columnTitles: PropTypes.arrayOf(
        PropTypes.oneOfType([
            PropTypes.string,
            PropTypes.element,
        ])),
    columnTitleClick: PropTypes.func,
    actions: PropTypes.node
};
