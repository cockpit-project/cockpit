
import React from 'react';
import PropTypes from 'prop-types';
import cockpit from 'cockpit';
import { OverlayTrigger, Tooltip } from "patternfly-react";

const _ = cockpit.gettext;

const WarningInactive = ({ iconId, tooltipId }) => {
    return (
        <OverlayTrigger overlay={ <Tooltip id={tooltipId}>{ _("Changes will take effect after shutting down the VM") }</Tooltip> } placement='top'>
            <i id={iconId} className='pficon pficon-pending' />
        </OverlayTrigger>
    );
};

WarningInactive.propTypes = {
    iconId: PropTypes.string.isRequired,
    tooltipId: PropTypes.string.isRequired,
};

export default WarningInactive;
