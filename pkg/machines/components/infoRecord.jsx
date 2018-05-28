/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

import React from "react";
import PropTypes from "prop-types";
import { Tooltip } from "cockpit-components-tooltip.jsx";

const InfoRecord = ({id, descr, value, descrClass, valueClass, tooltip}) => {
    return (<tr>
        <td className={descrClass || 'top'}>
            <label className='control-label'>
                {descr}
            </label>
        </td>
        <td id={id} className={valueClass}>
            {value}
        </td>
        {tooltip && (<td><Tooltip tip={tooltip} pos="top">
            <span className="fa fa-lg fa-info-circle" />
        </Tooltip></td>)}
    </tr>);
};

InfoRecord.propTypes = {
    id: PropTypes.string,
    descr: PropTypes.string.isRequired,
    descrClass: PropTypes.string,
    valueClass: PropTypes.string,
    value: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.element
    ]).isRequired,
    tooltip: PropTypes.string,
};

export default InfoRecord;
