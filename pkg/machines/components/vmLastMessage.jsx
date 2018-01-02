/*jshint esversion: 6 */
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
import cockpit from 'cockpit';
import React from "react";
import { vmId } from '../helpers.es6';
import { deleteVmMessage } from '../actions.es6';
import './vmLastMessage.css';

const _ = cockpit.gettext;

class InlineNotification extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            isDetail: false,
        };

        this.toggleDetail = this.toggleDetail.bind(this);
    }

    toggleDetail () {
        this.setState({
            isDetail: !this.state.isDetail,
        });
    }

    render () {
        const { text, detail, textId, onDismiss } = this.props;

        let detailButtonText = _("show more");
        if (this.state.isDetail) {
            detailButtonText = _("show less");
        }
        const detailButton = (<a href='#' className='alert-link machines-more-button' onClick={this.toggleDetail}>{detailButtonText}</a>);

        // do not use "data-dismiss='alert'" to close the notification
        return (
            <div className='alert alert-warning alert-dismissable'>
                <button type='button' className='close' aria-hidden='true' onClick={onDismiss}>
                    <span className='pficon pficon-close'/>
                </button>
                <span className='pficon pficon-warning-triangle-o'/>
                <strong id={textId}>
                    {text}
                </strong>
                {detailButton}
                {this.state.isDetail && detail}
            </div>
        );
    }
}

const VmLastMessage = ({ vm, dispatch }) => {
    if (!vm.lastMessage) {
        return null;
    }

    const textId = `${vmId(vm.name)}-last-message`;
    let detail = (vm.lastMessageDetail && vm.lastMessageDetail.exception) ? vm.lastMessageDetail.exception : null;
    detail = detail && (<p>{detail}</p>);

    const onDismiss = () => {
        dispatch(deleteVmMessage({ name: vm.name, connectionName: vm.connectionName }));
    };

    return (<InlineNotification text={vm.lastMessage} textId={textId} detail={detail} onDismiss={onDismiss} />);
};

export default VmLastMessage;
