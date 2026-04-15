/*
 * Copyright (C) 2016 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */
import React, { useState } from 'react';
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
