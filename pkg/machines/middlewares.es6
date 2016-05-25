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

import { logDebug } from './helpers.es6';

/**
 * Middleware that resolves functions taking (dispatch, getState) and promises.
 *
 * If a promise is passed the dispatch will just return the passed promise.
 * This is done to simplify some client code that can sometime dispatch a promise and sometimes a plain action.
 *
 * If a function is passed (which is not a promise) we perform the usual injection of (dispatch, getState).
 */
export function thunk({ dispatch, getState }) {
    logDebug('thunk-middleware');

    return next => action => {
        if (typeof action === 'function') {
            // cockpit style promise is also typeof 'function'
            // so we differentiate between those two by the presence of property 'then'
            return action.then ? action : action(dispatch, getState);
        }

        return next(action);
    };
}
