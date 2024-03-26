/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Tooltip, TooltipPosition } from "@patternfly/react-core/dist/esm/components/Tooltip/index.js";

import cockpit from "cockpit";
import { superuser } from 'superuser';
import { useEvent, useLoggedInUser } from "hooks";

/**
 * UI element wrapper for something that requires privilege. When access is not
 * allowed, then wrap the element into a Tooltip.
 *
 * Note that the wrapped element itself needs to be disabled explicitly, this
 * wrapper cannot do this (unfortunately wrapping it into a disabled span does
 * not inherit).
 */
export function Privileged({ excuse, allowed, placement, tooltipId, children }) {
    // wrap into extra <span> so that a disabled child keeps the tooltip working
    let contents = <span id={allowed ? null : tooltipId}>{ children }</span>;
    if (!allowed) {
        contents = (
            <Tooltip position={ placement || TooltipPosition.top} id={ tooltipId + "_tooltip" }
                     content={ excuse }>
                { contents }
            </Tooltip>);
    }
    return contents;
}

/**
 * Convenience element for a Privilege wrapped Button
 */
export const PrivilegedButton = ({ tooltipId, placement, excuse, buttonId, onClick, ariaLabel, variant, isDanger, children }) => {
    const user = useLoggedInUser();
    useEvent(superuser, "changed");

    return (
        <Privileged allowed={ superuser.allowed } tooltipId={ tooltipId } placement={ placement }
                    excuse={ cockpit.format(excuse, user?.name ?? '') }>
            <Button id={ buttonId } variant={ variant } isDanger={ isDanger } onClick={ onClick }
                    isInline isDisabled={ !superuser.allowed } aria-label={ ariaLabel }>
                { children }
            </Button>
        </Privileged>
    );
};

PrivilegedButton.propTypes = {
    excuse: PropTypes.string.isRequired, // must contain a $0, replaced with user name
    onClick: PropTypes.func,
    variant: PropTypes.string,
    placement: PropTypes.string, // default: top
    buttonId: PropTypes.string,
    tooltipId: PropTypes.string,
    ariaLabel: PropTypes.string,
};
