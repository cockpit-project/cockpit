/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

// @flow
import React, { PropTypes } from 'react';

import type { Message as MessageType } from '../../types.jsx';
import {prefixedId, getValueOrDefault} from '../../utils.jsx';
import { Alert } from '../../../../../machines/components/notification/inlineNotification.jsx';

const Message = ({ idPrefix, message, onDismiss }: { idPrefix: string, message: MessageType, onDismiss: Function }) => {
    if (!message) {
        return null;
    }

    // so far just the last message is kept, see the message reducers
    let detail;
    if (getValueOrDefault(() => message.detail.message)) {
        detail = (<p>{message.detail.message}</p>);
    }

    const textId = prefixedId(idPrefix, 'message');
    return (<Alert text={message.message} textId={textId} detail={detail} onDismiss={onDismiss} />);
};

Message.propTypes = {
    idPrefix: PropTypes.string.isRequired,
    message: PropTypes.object,
    onDismiss: PropTypes.func.isRequired,
};

export default Message;
