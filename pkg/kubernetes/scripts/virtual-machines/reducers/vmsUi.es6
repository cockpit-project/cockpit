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

import { createReducer, updateUidContent, deleteUidContent } from './utils.es6';
import * as actionTypes from '../action-types.es6';

/**
 * state = {
 *  vmUID: {
 *      isVisible: boolean,
 *      message: {
 *          message: string,
 *          detail: string,
 *      },
 *    },
 * }
 */
const vmsUiReducer = createReducer({}, {
    [actionTypes.SHOW_VM]: (state = {}, { payload: {vm, isVisible} }) => {
        return updateUidContent(state, vm.metadata.uid, {isVisible});
    },

    [actionTypes.VM_ACTION_FAILED]: (state = {}, { payload: { vm, message, detail } }) => {
        return updateUidContent(state, vm.metadata.uid, {
            message: { // So far the last message is kept only
                message, // textual information
                detail, // i.e. exception
            }
        });
    },

    [actionTypes.REMOVE_VM_MESSAGE]: (state = {}, { payload: { vm } }) => {
        return deleteUidContent(state, vm.metadata.uid, 'message');
    },
});

export default vmsUiReducer;
