/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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
import { useState, useEffect, useRef } from 'react';
import deep_equal from "deep-equal";

export function useCockpitLocation() {
    const [path, setPath] = useState(cockpit.location.path);

    useEffect(() => {
        function updatePath() {
            setPath(cockpit.location.path);
        }

        cockpit.addEventListener("locationchanged", updatePath);
        return function () {
            cockpit.removeEventListener("locationchanged", updatePath);
        };
    }, []);

    return path;
}

const cockpit_user_promise = cockpit.user();
var cockpit_user = null;
cockpit_user_promise.then(user => { cockpit_user = user });

export function useCockpitUser() {
    const [user, setUser] = useState(cockpit_user);
    useEffect(() => { if (!cockpit_user) cockpit_user_promise.then(setUser); }, []);
    return user;
}

function useDeepEqualMemo(value) {
    const ref = useRef(value);
    if (!deep_equal(ref.current, value))
        ref.current = value;
    return ref.current;
}

export function useFile(path, options) {
    const [content, setContent] = useState(null);
    const memo_options = useDeepEqualMemo(options);

    useEffect(() => {
        const handle = cockpit.file(path, memo_options);
        handle.watch((data, tag, error) => {
            setContent(data);
            if (!data)
                console.warn("Can't read " + path + ": " + (error ? error.toString() : "not found"));
        });
        return function () {
            handle.close();
        };
    }, [path, memo_options]);

    return content;
}
