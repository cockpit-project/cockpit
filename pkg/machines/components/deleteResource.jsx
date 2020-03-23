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
import { Modal, OverlayTrigger, Tooltip } from 'patternfly-react';
import { Button } from '@patternfly/react-core';

import cockpit from 'cockpit';
import { ModalError } from 'cockpit-components-inline-notification.jsx';

const _ = cockpit.gettext;

export class DeleteResource extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            showModal: false,
            dialogError: undefined,
            inProgress: false,
        };

        this.delete = this.delete.bind(this);
        this.close = this.close.bind(this);
        this.open = this.open.bind(this);
        this.dialogErrorSet = this.dialogErrorSet.bind(this);
    }

    delete() {
        this.setState({ inProgress: true });
        this.props.deleteHandler()
                .fail(exc => {
                    this.setState({ inProgress: false });
                    this.dialogErrorSet(cockpit.format(_("The $0 could not be deleted"), this.props.objectType.toLowerCase()), exc.message);
                });
    }

    open() {
        this.setState({ showModal: true });
    }

    close() {
        this.setState({ showModal: false, dialogError: undefined });
    }

    dialogErrorSet(text, detail) {
        this.setState({ dialogError: text, dialogErrorDetail: detail });
    }

    render() {
        const { objectName, objectType, objectId, disabled, overlayText, actionName } = this.props;

        const deleteButton = () => {
            if (disabled) {
                return (
                    <OverlayTrigger overlay={
                        <Tooltip id={`delete-${objectId}-tooltip`}>
                            { overlayText }
                        </Tooltip> } placement='top'>
                        <span>
                            <Button id={`delete-${objectId}`}
                                variant='danger'
                                style={{ pointerEvents: 'none' }}
                                isDisabled>
                                {actionName || _("Delete")}
                            </Button>
                        </span>
                    </OverlayTrigger>
                );
            } else {
                return (
                    <Button id={`delete-${objectId}`}
                        variant='danger'
                        onClick={this.open}>
                        {actionName || _("Delete")}
                    </Button>
                );
            }
        };

        return (
            <>
                { deleteButton() }

                <Modal show={this.state.showModal} onHide={this.close}>
                    <Modal.Header>
                        <Modal.CloseButton onClick={this.close} />
                        <Modal.Title>{ (actionName || _("Delete")) + cockpit.format((" $0 $1"), objectType, objectName) }</Modal.Title>
                    </Modal.Header>
                    <Modal.Body>
                        { cockpit.format(_("Confirm this action")) }
                    </Modal.Body>
                    <Modal.Footer>
                        {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                        <Button variant='danger' isDisabled={this.state.inProgress} onClick={this.delete}>
                            {actionName || _("Delete")}
                        </Button>
                        <Button variant='link' className='btn-cancel' onClick={this.close}>
                            {_("Cancel")}
                        </Button>
                        {this.state.inProgress && <div className="spinner spinner-sm pull-right" />}
                    </Modal.Footer>
                </Modal>
            </>
        );
    }
}

DeleteResource.propTypes = {
    objectType: PropTypes.string.isRequired,
    objectName: PropTypes.string.isRequired,
    objectId: PropTypes.string.isRequired,
    deleteHandler: PropTypes.func.isRequired,
    disabled: PropTypes.bool,
    overlayText: PropTypes.string,
    actionName: PropTypes.string,
};
