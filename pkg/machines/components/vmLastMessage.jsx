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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */
import React from "react";
import { vmId } from '../helpers.es6';
import { deleteVmMessage } from '../actions/store-actions.es6';
import { Alert } from './notification/inlineNotification.jsx';

const VmLastMessage = ({ vm, dispatch }) => {
    if (!vm.lastMessage) {
        return null;
    }

    const textId = `${vmId(vm.name)}-last-message`;
    let detail = (vm.lastMessageDetail && vm.lastMessageDetail.exception) ? vm.lastMessageDetail.exception : undefined;
    detail = detail ? (detail.toString ? detail.toString() : detail) : undefined;

    const onDismiss = () => {
        dispatch(deleteVmMessage({ name: vm.name, connectionName: vm.connectionName }));
    };

    return (<Alert text={vm.lastMessage} textId={textId} detail={detail} onDismiss={onDismiss} />);
};

export default VmLastMessage;
