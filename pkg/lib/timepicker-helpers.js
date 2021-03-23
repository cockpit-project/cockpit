/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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

// FIXME: https://github.com/patternfly/patternfly-react/issues/5564
// Copied from: https://github.com/patternfly/patternfly-react/blob/master/packages/react-core/src/components/TimePicker/TimePickerUtils.tsx
// and slightly adjusted
export const validateTime = (time) => {
    // ISO 8601 format is valid
    const date = new Date(time);
    if (!isNaN(date.getDate()) && time.includes('T')) {
        return true;
    }
    // hours only valid if they are [0-23] or [0-12]
    const hours = parseInt(time.split(":")[0]);
    const validHours = hours >= 0 && hours <= 23;

    // minutes verified by timeRegex
    const timeRegex = new RegExp(`^\\s*\\d\\d?:[0-5]\\d\\s*$`);

    // empty string is valid
    return time !== '' && (timeRegex.test(time) && validHours);
};
