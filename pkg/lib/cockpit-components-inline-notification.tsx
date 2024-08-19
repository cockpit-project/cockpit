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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */
import React, { useState } from 'react';
import PropTypes from 'prop-types';
import cockpit from 'cockpit';

import { Alert, AlertActionCloseButton, AlertProps } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import './cockpit-components-inline-notification.css';

const _ = cockpit.gettext;

export const InlineNotification = ({ text, detail, type = "danger", onDismiss, isInline = true, isLiveRegion = false }: {
    text: string;
    detail?: string;
    type?: AlertProps["variant"];
    onDismiss?: (ev?: Event) => void;
    isInline?: boolean;
    isLiveRegion?: boolean;
}) => {
    const [isDetail, setIsDetail] = useState(false);

    const detailButton = (detail &&
        <Button variant="link" isInline className="alert-link more-button"
            onClick={event => {
                if (event.button !== 0)
                    return;
                event.preventDefault();
                setIsDetail(prev => !prev);
            }}
        >
            {isDetail ? _("show less") : _("show more")}
        </Button>
    );

    return (
        <Alert variant={type}
            isLiveRegion={isLiveRegion}
            isInline={isInline}
            title={<> {text} {detailButton} </>}
            { ...onDismiss && { actionClose: <AlertActionCloseButton onClose={onDismiss} /> } }>
            {isDetail && (<p>{detail}</p>)}
        </Alert>
    );
};

InlineNotification.propTypes = {
    onDismiss: PropTypes.func,
    isInline: PropTypes.bool,
    text: PropTypes.string.isRequired, // main information to render
    detail: PropTypes.string, // optional, more detailed information. If empty, the more/less button is not rendered.
    type: PropTypes.string,
    isLiveRegion: PropTypes.bool,
};

export const ModalError = ({ dialogError, dialogErrorDetail, id, isExpandable }: {
    dialogError: string,
    dialogErrorDetail?: string,
    id?: string,
    isExpandable?: boolean,
}) => {
    return (
        <Alert {...id && { id }} variant='danger' isInline title={dialogError} isExpandable={!!isExpandable}>
            { typeof dialogErrorDetail === 'string' ? <p>{dialogErrorDetail}</p> : dialogErrorDetail }
        </Alert>
    );
};
