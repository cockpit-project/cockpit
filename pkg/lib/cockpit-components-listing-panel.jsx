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
import { Tab, TabTitleText, Tabs } from "@patternfly/react-core/dist/esm/components/Tabs/index.js";
import './cockpit-components-listing-panel.scss';

/* tabRenderers optional: list of tab renderers for inline expansion, array of objects with
 *     - name tab name (has to be unique in the entry, used as react key)
 *     - renderer react component
 *     - data render data passed to the tab renderer
 */
export class ListingPanel extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            activeTab: props.initiallyActiveTab ? props.initiallyActiveTab : 0, // currently active tab in expanded mode, defaults to first tab
        };
        this.handleTabClick = this.handleTabClick.bind(this);
    }

    handleTabClick(event, tabIndex) {
        event.preventDefault();
        if (this.state.activeTab !== tabIndex) {
            this.setState({ activeTab: tabIndex });
        }
    }

    render() {
        let listingDetail;
        if ('listingDetail' in this.props) {
            listingDetail = (
                <span className="ct-listing-panel-caption">
                    {this.props.listingDetail}
                </span>
            );
        }

        return (
            <div className="ct-listing-panel">
                {listingDetail && <div className="ct-listing-panel-actions pf-v5-c-tabs">
                    {listingDetail}
                </div>}
                {this.props.tabRenderers.length && <Tabs activeKey={this.state.activeTab} className="ct-listing-panel-tabs" mountOnEnter onSelect={this.handleTabClick}>
                    {this.props.tabRenderers.map((itm, tabIdx) => {
                        const Renderer = itm.renderer;
                        const rendererData = itm.data;

                        return (
                            <Tab key={tabIdx} eventKey={tabIdx} title={<TabTitleText>{itm.name}</TabTitleText>}>
                                <div className="ct-listing-panel-body" key={tabIdx} data-key={tabIdx}>
                                    <Renderer {...rendererData} />
                                </div>
                            </Tab>
                        );
                    })}
                </Tabs>}
            </div>
        );
    }
}
ListingPanel.defaultProps = {
    tabRenderers: [],
};

ListingPanel.propTypes = {
    tabRenderers: PropTypes.array,
    listingDetail: PropTypes.node,
    initiallyActiveTab: PropTypes.number,
};
