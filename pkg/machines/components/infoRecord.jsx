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
import { OverlayTrigger, Tooltip } from "patternfly-react";

import cockpit from "cockpit";

const _ = cockpit.gettext;

const InfoRecord = ({ id, descr, value, descrClass, valueClass, tooltip }) => {
    let labelClass = cockpit.format(_("control-label $0"), descrClass || 'top');
    let infoContent;

    if (tooltip) {
        infoContent = (
            <div id={id} className={valueClass} role="group">
                {value}
                {tooltip && (<OverlayTrigger overlay={ <Tooltip id="tip-inforec">{tooltip}</Tooltip> } placement="top">
                    <span className="fa fa-lg fa-info-circle" />
                </OverlayTrigger>)}
            </div>
        );
    } else {
        infoContent = (
            <div id={id} className={valueClass} role="group">
                {value}
            </div>
        );
    }

    return (<React.Fragment>
        <label htmlFor={id} className={labelClass}>
            {descr}
        </label>
        {infoContent}
    </React.Fragment>);
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
