/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

/* Counting down a session timeout */

import cockpit from "cockpit";
import { useOn } from "hooks";

import React from 'react';
import {
    Modal, ModalBody, ModalFooter, ModalHeader
} from '@patternfly/react-core/dist/esm/components/Modal/index.js';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";

const _ = cockpit.gettext;

export const SessionCountdownModal = () => {
    const controller = cockpit.get_session_controller();
    useOn(controller, "changed");

    controller.inhibit_activity_reporting(controller.countdown > 0);

    if (controller.countdown <= 0)
        return null;

    return (
        <Modal isOpen position="top" variant="medium"
               id="session-timeout-modal">
            <ModalHeader title={_("Session is about to expire")} />
            <ModalBody>
                { cockpit.format(_("You will be logged out in $0 seconds."), controller.countdown) }
            </ModalBody>
            <ModalFooter>
                <Button variant='primary'
                    onClick={() => controller.continue_session()}
                >
                    {_("Continue session")}
                </Button>
            </ModalFooter>
        </Modal>
    );
};
