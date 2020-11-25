
import React from 'react';
import PropTypes from 'prop-types';
import cockpit from 'cockpit';
import { Tooltip } from "@patternfly/react-core";

const _ = cockpit.gettext;

const WarningInactive = ({ iconId, tooltipId }) => {
    return (
        <Tooltip id={tooltipId} content={_("Changes will take effect after shutting down the VM")}>
            <i id={iconId} className='pficon pficon-pending' />
        </Tooltip>
    );
};

WarningInactive.propTypes = {
    iconId: PropTypes.string.isRequired,
    tooltipId: PropTypes.string.isRequired,
};

export default WarningInactive;
