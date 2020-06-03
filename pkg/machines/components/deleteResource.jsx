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
import { Modal } from 'patternfly-react';
import { Button, Tooltip } from '@patternfly/react-core';

import cockpit from 'cockpit';
import { ModalError } from 'cockpit-components-inline-notification.jsx';

const _ = cockpit.gettext;

export class DeleteResourceModal extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            dialogError: undefined,
            inProgress: false,
        };

        this.delete = this.delete.bind(this);
        this.dialogErrorSet = this.dialogErrorSet.bind(this);
    }

    delete() {
        this.setState({ inProgress: true });
        this.props.deleteHandler()
                .then(this.props.onClose, exc => {
                    this.setState({ inProgress: false });
                    this.dialogErrorSet(cockpit.format(_("The $0 could not be deleted"), this.props.objectType.toLowerCase()), exc.message);
                });
    }

    dialogErrorSet(text, detail) {
        this.setState({ dialogError: text, dialogErrorDetail: detail });
    }

    render() {
        const { objectName, objectType, actionName, onClose } = this.props;

        return (
            <Modal show onHide={onClose}>
                <Modal.Header>
                    <Modal.CloseButton onClick={onClose} />
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
                    <Button variant='link' className='btn-cancel' onClick={onClose}>
                        {_("Cancel")}
                    </Button>
                    {this.state.inProgress && <div className="spinner spinner-sm pull-right" />}
                </Modal.Footer>
            </Modal>
        );
    }
}

DeleteResourceModal.propTypes = {
    objectType: PropTypes.string.isRequired,
    objectName: PropTypes.string.isRequired,
    deleteHandler: PropTypes.func.isRequired,
    onClose: PropTypes.func.isRequired,
};

export const DeleteResourceButton = ({ objectId, disabled, overlayText, actionName, showDialog }) => {
    if (disabled) {
        return (
            <Tooltip id={`delete-${objectId}-tooltip`}
                     content={overlayText}>
                <span>
                    <Button id={`delete-${objectId}`}
                        variant='danger'
                        isDisabled>
                        {actionName || _("Delete")}
                    </Button>
                </span>
            </Tooltip>
        );
    } else {
        return (
            <Button id={`delete-${objectId}`}
                variant='danger'
                onClick={showDialog}>
                {actionName || _("Delete")}
            </Button>
        );
    }
};
DeleteResourceButton.propTypes = {
    objectId: PropTypes.string.isRequired,
    disabled: PropTypes.bool,
    overlayText: PropTypes.string,
    actionName: PropTypes.string,
    showDialog: PropTypes.func.isRequired,
};
