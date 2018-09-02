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
import cockpit from 'cockpit';
import React, { PropTypes } from "react";

const _ = cockpit.gettext;

const getBootstrapColumnsClasses = (sizes) => {
    if (!sizes) {
        sizes = [];
    }
    // fill the sizes with the last one or default to 12
    if (sizes.length < 4) {
        const lastDivider = sizes.length > 0 ? sizes[sizes.length - 1] : 12;
        sizes = [...sizes, ...Array(4 - sizes.length).fill(lastDivider)];
    }

    return `col-lg-${sizes[0]} col-md-${sizes[1]} col-sm-${sizes[2]} col-xs-${sizes[3]}`;
};

const ItemsRow = ({ items, idPrefix, colClass }) => {
    if (!items) {
        return null;
    }

    colClass = colClass || getBootstrapColumnsClasses([6, 6, 6, 12]);

    return (
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
                    <div className={`${colClass} ${item.className || ''}`}>
                        {content}
                    </div>
                );
            })}
        </div>
    );
};

export const Items = ({ items, idPrefix, dividers, colClass }) => {
    if (!items) {
        return null;
    }

    return (
        <div className={getBootstrapColumnsClasses(dividers)}>
            <ItemsRow items={items} idPrefix={idPrefix} colClass={colClass} />
        </div>
    );
};

Items.propTypes = {
    items: PropTypes.array, // array of items to be rendered. Each item is an object of { title, value, idPostfix }
    idPrefix: PropTypes.string.isRequired, // prefix for HTML IDs
    dividers: PropTypes.array.isRequired, // array with media class sizes
    colClass: PropTypes.string.isRequired, // className for each item
};

/**
 * Reusable "Overview" subtab for a VM.
 */
const VmOverviewTab = ({ message, idPrefix, items, extraItems }) => {
    return (
        <div>
            {message}
            <Items items={items} idPrefix={idPrefix} dividers={extraItems ? [6] : [12]} />
            {extraItems && extraItems.map(col =>
                (<Items items={col} idPrefix={idPrefix} dividers={[3]}
                        colClass={getBootstrapColumnsClasses([12])} />))}
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
