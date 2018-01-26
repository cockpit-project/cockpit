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
import React, { PropTypes } from 'react'
import { connect } from 'react-redux'

import type { Vm, VmMessages } from '../types.jsx'
import { vmIdPrefx } from '../utils.jsx'
import { Alert } from '../../../../machines/components/inlineNotification.jsx';

import { removeVmMessage } from '../action-creators.jsx';

React;

const VmMessage = (({ vm, vmMessages, onDismiss }: { vm: Vm, vmMessages: VmMessages, onDismiss: Function }) => {
  if (!vmMessages) {
    return null;
  }

  // so far just the last message is kept, see the vmsMessagesReducer
  let detail;
  if (vmMessages.detail && vmMessages.detail.message) {
    detail = (<p>{vmMessages.detail.message}</p>);
  }

  const textId = `${vmIdPrefx(vm)}-message`;
  return (<Alert text={vmMessages.message} textId={textId} detail={detail} onDismiss={onDismiss} />);
});

VmMessage.propTypes = {
    vm: PropTypes.object.isRequired,
    vmMessages: PropTypes.object.isRequired,
    onDismiss: PropTypes.func.isRequired,
};

export default connect(
  () => ({  }),
  (dispatch, { vm }) => ({
    onDismiss: () => dispatch(removeVmMessage({ vm })),
  }),
)(VmMessage);
