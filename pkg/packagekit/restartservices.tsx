/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */
import React from "react";
import cockpit from "cockpit";

import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@patternfly/react-core/dist/esm/components/Modal/index.js';
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";

import { ModalError } from 'cockpit-components-inline-notification.jsx';

import { TwoColumnContent } from "./two-column";

const _ = cockpit.gettext;

export interface RestartPackages {
    reboot: string[];
    daemons: string[];
    manual: string[];
}

interface RestartServicesProps {
    restartPackages: RestartPackages;
    close: () => void;
    state: string;
    checkNeedsRestart: () => void;
    onValueChanged: (delta: { restartPackages: RestartPackages }) => void;
    loadUpdates: () => void;
    checkRestartRunning?: boolean;
}

interface RestartServicesState {
    dialogError: string | undefined;
    dialogErrorDetail: string | undefined;
    restartInProgress: boolean;
}

export class RestartServices extends React.Component<RestartServicesProps, RestartServicesState> {
    constructor(props: RestartServicesProps) {
        super(props);
        this.state = {
            dialogError: undefined,
            dialogErrorDetail: undefined,
            restartInProgress: false,
        };

        this.restart = this.restart.bind(this);
    }

    restart() {
        // make sure cockpit package is the last to restart
        const daemons = this.props.restartPackages.daemons.sort((a, b) => {
            if (a.includes("cockpit") && b.includes("cockpit"))
                return 0;
            if (a.includes("cockpit"))
                return 1;
            return a.localeCompare(b);
        });
        const restarts = daemons.map(service => cockpit.spawn(["systemctl", "restart", service], { superuser: "require", err: "message" }));
        this.setState({ restartInProgress: true, dialogError: undefined, dialogErrorDetail: undefined });
        Promise.all(restarts)
                .then(() => {
                    this.props.onValueChanged({ restartPackages: { reboot: this.props.restartPackages.reboot, daemons: [], manual: this.props.restartPackages.manual } });
                    if (this.props.state === "updateSuccess")
                        this.props.loadUpdates();
                    this.setState({ restartInProgress: false });
                    this.props.close();
                })
                .catch(ex => {
                    this.setState({ dialogError: _("Failed to restart service"), dialogErrorDetail: ex.message });
                    // see what services remain
                    this.props.checkNeedsRestart();
                });
    }

    render() {
        let body;
        if (this.props.checkRestartRunning) {
            body = (
                <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                    <Spinner size="sm" />
                    <p>{_("Reloading the state of remaining services")}</p>
                </Flex>
            );
        } else if (this.props.restartPackages.daemons.length > 0) {
            body = (<>
                {cockpit.ngettext("The following service will be restarted:", "The following services will be restarted:", this.props.restartPackages.daemons.length)}
                <TwoColumnContent list={this.props.restartPackages.daemons} flexClassName="restart-services-modal-body" />
            </>);
        }

        return (
            <Modal id="restart-services-modal" isOpen
                   position="top"
                   variant="medium"
                   onClose={this.props.close}>
                <ModalHeader title={_("Restart services")} />
                <ModalBody>
                    <Stack hasGutter>
                        {this.state.dialogError &&
                        <ModalError dialogError={this.state.dialogError} {...(this.state.dialogErrorDetail && { dialogErrorDetail: this.state.dialogErrorDetail })} />}
                        <StackItem>{body}</StackItem>
                    </Stack>
                </ModalBody>
                <ModalFooter>
                    {this.props.restartPackages.daemons.includes("cockpit") &&
                        <Alert variant="warning"
                            title={_("Web Console will restart")}
                            isInline>
                            <p>
                                {_("When the Web Console is restarted, you will no longer see progress information. However, the update process will continue in the background. Reconnect to continue watching the update process.")}
                            </p>
                        </Alert>}
                    <Button variant='primary'
                        isDisabled={ this.state.restartInProgress }
                        onClick={ this.restart }>
                        {_("Restart services")}
                    </Button>
                    <Button variant='link' className='btn-cancel' onClick={ this.props.close }>
                        {_("Cancel")}
                    </Button>
                </ModalFooter>
            </Modal>
        );
    }
}
