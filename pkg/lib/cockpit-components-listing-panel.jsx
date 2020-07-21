/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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
import { Nav, NavItem, NavList } from '@patternfly/react-core';
import './cockpit-components-listing-panel.scss';

/* tabRenderers optional: list of tab renderers for inline expansion, array of objects with
 *     - name tab name (has to be unique in the entry, used as react key)
 *     - renderer react component
 *     - data render data passed to the tab renderer
 *     - presence 'always', 'onlyActive', 'loadOnDemand', default: 'loadOnDemand'
 *         - 'always' once a row is expanded, this tab is always rendered, but invisible if not active
 *         - 'onlyActive' the tab is only rendered when active
 *         - 'loadOnDemand' the tab is first rendered when it becomes active, then follows 'always' behavior
 * listingActions optional: buttons that are presented as actions for the expanded item
 * simpleBody optional: if set the expansion will just contain this simple body without tabs,
 *                      this does not work well with tabRenderers.
 */
export class ListingPanel extends React.Component {
    constructor(props) {
        super(props);
        const loadedTabs = {};
        // see if we should preload some tabs
        let tabPresence;
        for (let tabIdx = 0; tabIdx < props.tabRenderers.length; tabIdx++) {
            if ('presence' in props.tabRenderers[tabIdx])
                tabPresence = props.tabRenderers[tabIdx].presence;
            else
                tabPresence = 'default';
            // the active tab is covered by separate logic
            if (tabPresence == 'always')
                loadedTabs[tabIdx] = true;
        }
        // ensure the active tab is loaded
        loadedTabs[props.initiallyActiveTab || 0] = true;

        this.state = {
            activeTab: props.initiallyActiveTab ? props.initiallyActiveTab : 0, // currently active tab in expanded mode, defaults to first tab
            loadedTabs, // which tabs were already loaded - this is important for 'loadOnDemand' setting
        };
        this.handleTabClick = this.handleTabClick.bind(this);
    }

    handleTabClick(result) {
        result.event.preventDefault();

        const prevTab = this.state.activeTab;
        let prevTabPresence = 'default';
        const loadedTabs = this.state.loadedTabs;
        if (prevTab !== result.itemId) {
            // see if we need to unload the previous tab
            if (this.props.tabRenderers[prevTab] && 'presence' in this.props.tabRenderers[prevTab])
                prevTabPresence = this.props.tabRenderers[prevTab].presence;

            if (prevTabPresence == 'onlyActive')
                delete loadedTabs[prevTab];

            // ensure the new tab is loaded and update state
            loadedTabs[result.itemId] = true;
            this.setState({ loadedTabs: loadedTabs, activeTab: result.itemId });
        }
    }

    render() {
        const links = this.props.tabRenderers.map((itm, idx) => {
            return (
                <NavItem key={idx} id={itm.id} itemId={idx} isActive={idx === this.state.activeTab}>
                    {itm.name}
                </NavItem>
            );
        });
        const tabs = [];
        let tabIdx;
        let Renderer;
        let rendererData;
        let row;

        if (this.state.activeTab >= this.props.tabRenderers.length)
            this.state.activeTab = this.props.tabRenderers.length - 1;

        for (tabIdx = 0; tabIdx < this.props.tabRenderers.length; tabIdx++) {
            Renderer = this.props.tabRenderers[tabIdx].renderer;
            rendererData = this.props.tabRenderers[tabIdx].data;
            if (tabIdx !== this.state.activeTab && !(tabIdx in this.state.loadedTabs))
                continue;
            row = <Renderer key={ this.props.tabRenderers[tabIdx].name } hidden={ (tabIdx !== this.state.activeTab) } {...rendererData} />;
            if (tabIdx === this.state.activeTab)
                tabs.push(<div className="ct-listing-panel-body" key={tabIdx}>{row}</div>);
            else
                tabs.push(<div className="ct-listing-panel-body" key={tabIdx} hidden>{row}</div>);
        }

        let listingDetail;
        if ('listingDetail' in this.props) {
            listingDetail = (
                <span className="ct-listing-panel-caption">
                    {this.props.listingDetail}
                </span>
            );
        }

        let simpleBody, heading;
        if (this.props.simpleBody) {
            heading =
                <div className="ct-listing-panel-actions ct-listing-panel-simplebody-actions">
                    {this.props.listingActions}
                </div>;
            simpleBody =
                <div className="ct-listing-panel-body" key="simplebody">
                    {this.props.simpleBody}
                </div>;
        } else {
            heading = (<div className="ct-listing-panel-head">
                {links.length && <Nav variant="tertiary" onSelect={this.handleTabClick}>
                    <NavList>
                        {links}
                    </NavList>
                </Nav>}
                <div className="ct-listing-panel-actions">
                    {listingDetail}
                    {this.props.listingActions}
                </div>
            </div>);
        }

        return (
            <>
                {heading}
                {simpleBody || tabs}
            </>
        );
    }
}
ListingPanel.defaultProps = {
    tabRenderers: [],
};

ListingPanel.propTypes = {
    tabRenderers: PropTypes.array,
    listingDetail: PropTypes.node,
    listingActions: PropTypes.node,
    initiallyActiveTab: PropTypes.number,
    simpleBody: PropTypes.node,
};
