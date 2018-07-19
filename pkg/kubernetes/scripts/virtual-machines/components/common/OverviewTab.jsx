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
import React, { PropTypes } from 'react';
import { Items } from '../../../../../machines/components/vmOverviewTab.jsx';

/**
 * Reusable "Overview" subtab for a VM.
 */
const OverviewTab = ({message, idPrefix, leftItems, rightItems}) => {
    const colClass = 'col-lg-12 col-md-12 col-sm-12 col-xs-12';
    const dividers = [6, 6, 6, 12];

    return (
        <div>
            {message}
            <div className={colClass}>
                <div className='row'>
                    <Items idPrefix={idPrefix} items={leftItems} dividers={dividers} colClass={colClass} />
                    <Items idPrefix={idPrefix} items={rightItems} dividers={dividers} colClass={colClass} />
                </div>
            </div>
        </div>);
};

OverviewTab.propTypes = {
    message: PropTypes.any, // optional, info/error message related to a VM; see VmMessage component
    idPrefix: PropTypes.string.isRequired, // prefix for HTML IDs
    leftItems: PropTypes.array, // array of items to be rendered. Each item is an object of { title, value, idPostfix }
    rightItems: PropTypes.array, // array of items to be rendered. Each item is an object of { title, value, idPostfix }
};

export default OverviewTab;
