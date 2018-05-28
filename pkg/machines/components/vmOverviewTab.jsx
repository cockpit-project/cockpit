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
import React from 'react';
import PropTypes from 'prop-types';
import cockpit from 'cockpit';

const _ = cockpit.gettext;

const Items = ({ items, idPrefix, divider, colClass }) => {
    if (!items) {
        return null;
    }

    colClass = colClass || 'col-lg-6 col-md-6 col-sm-6 col-xs-12';
    return (
        <div className={`col-lg-${divider} col-md-${divider} col-sm-${divider} col-xs-${divider}`}>
            <div className='row'>
                {items.map(item => {
                    let content = item.value;
                    if (item.title) {
                        content = (
                            <dl>
                                <dt>{item.title}</dt>
                                <dd id={`${idPrefix}-${item.idPostfix}`}>{item.value}</dd>
                            </dl>
                        );
                    }

                    return (
                        <div key={item.title} className={`${colClass} ${item.className || ''}`}>
                            {content}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

/**
 * Reusable "Overview" subtab for a VM.
 */
const VmOverviewTab = ({ message, idPrefix, items, extraItems }) => {
    return (
        <div>
            {message}
            <Items items={items} idPrefix={idPrefix} divider={extraItems ? 6 : 12} />
            {extraItems && extraItems.map(col =>
                (<Items items={col} idPrefix={idPrefix} divider='3'
                        colClass='col-lg-12 col-md-12 col-sm-12 col-xs-12' key={col} />))}
        </div>);
};

VmOverviewTab.propTypes = {
    message: PropTypes.any, // optional, info/error message related to a VM; see VmMessage component
    idPrefix: PropTypes.string.isRequired, // prefix for HTML IDs
    items: PropTypes.array, // array of items to be rendered. Each item is an object of { title, value, idPostfix }
};

/**
 * Unique wording for the same props across various use cases.
 */
export const commonTitles = {
    MEMORY: _("Memory:"),
    CPUS: _("vCPUs:"),
};

export default VmOverviewTab;
