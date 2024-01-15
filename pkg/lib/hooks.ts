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
import { useState, useEffect, useRef, useReducer } from 'react';
import deep_equal from "deep-equal";

/* HOOKS
 *
 * These are some custom React hooks for Cockpit specific things.
 *
 * Overview:
 *
 * - usePageLocation: For following along with cockpit.location.
 *
 * - useLoggedInUser: For accessing information about the currently
 * logged in user.
 *
 * - useFile: For reading and watching files.
 *
 * - useObject: For maintaining arbitrary stateful objects that get
 * created from the properties of a component.
 *
 * - useEvent: For reacting to events emitted by arbitrary objects.
 *
 * - useInit: For running a function once.
 *
 * - useDeepEqualMemo: A utility hook that can help with things that
 * need deep equal comparisons in places where React only offers
 * Object identity comparisons, such as with useEffect.
 */

/* - usePageLocation()
 *
 * function Component() {
 *   const location = usePageLocation();
 *   const { path, options } = usePageLocation();
 *
 *   ...
 * }
 *
 * This returns the current value of cockpit.location and the
 * component is re-rendered when it changes. "location" is always a
 * valid object and never null.
 *
 * See https://cockpit-project.org/guide/latest/cockpit-location.html
 */

export function usePageLocation() {
    const [location, setLocation] = useState(cockpit.location);

    useEffect(() => {
        function update() { setLocation(cockpit.location) }
        cockpit.addEventListener("locationchanged", update);
        return () => cockpit.removeEventListener("locationchanged", update);
    }, []);

    return location;
}

/* - useLoggedInUser()
 *
 * function Component() {
 *   const user_info = useLoggedInUser();
 *
 *   ...
 * }
 *
 * "user_info" is the object delivered by cockpit.user(), or null
 * while that object is not yet available.
 */

const cockpit_user_promise = cockpit.user();
let cockpit_user: cockpit.UserInfo | null = null;
cockpit_user_promise.then(user => { cockpit_user = user }).catch(err => console.log(err));

export function useLoggedInUser() {
    const [user, setUser] = useState<cockpit.UserInfo | null>(cockpit_user);
    useEffect(() => { if (!cockpit_user) cockpit_user_promise.then(setUser); }, []);
    return user;
}

/* - useDeepEqualMemo(value)
 *
 * function Component(options) {
 *   const memo_options = useDeepEqualMemo(options);
 *   useEffect(() => {
 *       const channel = cockpit.channel(..., memo_options);
 *       ...
 *       return () => channel.close();
 *   }, [memo_options]);
 *
 *   ...
 * }
 *
 * function ParentComponent() {
 *     const options = { superuser: true, host: "localhost" };
 *     return <Component options={options}/>
 * }
 *
 * Sometimes a useEffect hook has a deeply nested object as one of its
 * dependencies, such as options for a Cockpit channel.  However,
 * React will compare dependency values with Object.is, and would run
 * the effect hook too often.  In the example above, the "options"
 * variable of Component is a different object on each render
 * according to Object.is, but we only want to open a new channel when
 * the value of a field such as "superuser" or "host" has actually
 * changed.
 *
 * A call to useDeepEqualMemo will return some object that is deeply
 * equal to its argument, and it will continue to return the same
 * object (according to Object.is) until the parameter is not deeply
 * equal to it anymore.
 *
 * For the example, this means that "memo_options" will always be the
 * very same object, and the effect hook is only run once.  If we
 * would use "options" directly as a dependency of the effect hook,
 * the channel would be closed and opened on every render. This is
 * very inefficient, doesn't give the asynchronous channel time to do
 * its job, and will also lead to infinite loops when events on the
 * channel cause re-renders (which in turn will run the effect hook
 * again, which will cause a new event, ...).
 */

export function useDeepEqualMemo<T>(value: T): T {
    const ref = useRef(value);
    if (!deep_equal(ref.current, value))
        ref.current = value;
    return ref.current;
}

/* - useFile(path, options)
 * - useFileWithError(path, options)
 *
 * function Component() {
 *   const content = useFile("/etc/hostname", { superuser: "try" });
 *   const [content, error] = useFileWithError("/etc/hostname", { superuser: "try" });
 *
 *   ...
 * }
 *
 * The "path" and "options" parameters are passed unchanged to
 * cockpit.file().  Thus, if you need to parse the content of the
 * file, the best way to do that is via the "syntax" option.
 *
 * The "content" variable will reflect the content of the file
 * "/etc/hostname". When the file changes on disk, the component will
 * be re-rendered with the new content.
 *
 * When the file does not exist or there has been some error reading
 * it, "content" will be false.
 *
 * The "error" variable will contain any errors encountered while
 * reading the file.  It is false when there are no errors.
 *
 * When the file does not exist, "error" will be false.
 *
 * The "content" and "error" variables will be null until the file has
 * been read for the first time.
 *
 * useFile and useFileWithError are pretty much the same. useFile will
 * hide the exact error from the caller, which makes it slightly
 * cleaner to use when the exact error is not part of the UI. In the
 * case of error, useFile will log that error to the console and
 * return false.
 */

type UseFileWithErrorOptions = {
    log_errors?: boolean;
};

export function useFileWithError(path: string, options: cockpit.JsonObject, hook_options: UseFileWithErrorOptions) {
    const [content_and_error, setContentAndError] = useState<[string | false | null, cockpit.BasicError | false | null]>([null, null]);
    const memo_options = useDeepEqualMemo(options);
    const memo_hook_options = useDeepEqualMemo(hook_options);

    useEffect(() => {
        const handle = cockpit.file(path, memo_options);
        handle.watch((data, _tag, error) => {
            setContentAndError([data || false, error || false]);
            if (!data && memo_hook_options?.log_errors)
                console.warn("Can't read " + path + ": " + (error ? error.toString() : "not found"));
        });
        return handle.close;
    }, [path, memo_options, memo_hook_options]);

    return content_and_error;
}

export function useFile(path: string, options: cockpit.JsonObject) {
    const [content] = useFileWithError(path, options, { log_errors: true });
    return content;
}

/* - useObject(create, destroy, dependencies, comparators)
 *
 * function Component(param) {
 *   const obj = useObject(() => create_object(param),
 *                         obj => obj.close(),
 *                         [param] as const, [deep_equal])
 *
 *   ...
 * }
 *
 * This will call "create_object(param)" before the first render of
 * the component, and will call "obj.close()" after the last render.
 *
 * More precisely, create_object will be called as part of the first
 * call to useObject, i.e., at the very beginning of the first render.
 *
 * When "param" changes compared to the previous call to useObject
 * (according to the deep_equal function in the example above), the
 * object will also be destroyed and a new one will be created for the
 * new value of "param" (as part of the call to useObject).
 *
 * There is no time when the "obj" variable is null in the example
 * above; the first render already has a fully created object.  This
 * is an advantage that useObject has over useEffect, which you might
 * otherwise use to only create objects when dependencies have
 * changed.
 *
 * And unlike useMemo, useObject will run a cleanup function when a
 * component is removed.  Also unlike useMemo, useObject guarantees
 * that it will not ignore the dependencies.
 *
 * The dependencies are an array of values that are by default
 * compared with Object.is.  If you need to use a custom comparator
 * function instead of Object.is, you can provide a second
 * "comparators" array that parallels the "dependencies" array.  The
 * values at a given index in the old and new "dependencies" arrays
 * are compared with the function at the same index in "comparators".
 */

type Tuple = readonly [...unknown[]];
type Comparator<T> = (a: T, b: T) => boolean;
type Comparators<T extends Tuple> = {[ t in keyof T ]?: Comparator<T[t]>};

function deps_changed<T extends Tuple>(old_deps: T | null, new_deps: T, comps: Comparators<T>): boolean {
    return (!old_deps || old_deps.length != new_deps.length ||
            old_deps.findIndex((o, i) => !(comps[i] || Object.is)(o, new_deps[i])) >= 0);
}

export function useObject<T, D extends Tuple>(create: () => T, destroy: ((value: T) => void) | null, deps: D, comps?: Comparators<D>): T {
    const ref = useRef<T | null>(null);
    const deps_ref = useRef<D | null>(null);
    const destroy_ref = useRef<((value: T) => void) | null>(destroy);

    /* Since each item in Comparators<> is optional, `[]` should be valid here
     * but for some reason it doesn't work — but `{}` does.
     */
    if (deps_changed(deps_ref.current, deps, comps || {})) {
        if (ref.current && destroy)
            destroy(ref.current);
        ref.current = create();
        deps_ref.current = deps;
    }

    destroy_ref.current = destroy;
    useEffect(() => {
        return () => { destroy_ref.current?.(ref.current!) };
    }, []);

    return ref.current!;
}

/* - useEvent(obj, event, handler)
 *
 * function Component(proxy) {
 *   useEvent(proxy, "changed");
 *
 *   ...
 * }
 *
 * The component will be re-rendered whenever "proxy" emits the
 * "changed" signal.  The "proxy" parameter can be null.
 *
 * When the optional "handler" is given, it will be called with the
 * arguments of the event.
 */

export function useEvent<EM extends cockpit.EventMap, E extends keyof EM>(obj: cockpit.EventSource<EM>, event: E, handler?: cockpit.EventListener<EM[E]>) {
    // We increase a (otherwise unused) state variable whenever the event
    // happens.  That reliably triggers a re-render.

    const [, forceUpdate] = useReducer(x => x + 1, 0);

    useEffect(() => {
        function update(...args: Parameters<cockpit.EventListener<EM[E]>>) {
            if (handler)
                handler(...args);
            forceUpdate();
        }

        obj?.addEventListener(event, update);
        return () => obj?.removeEventListener(event, update);
    }, [obj, event, handler]);
}

/* - useInit(func, deps, comps)
 *
 * function Component(arg) {
 *   useInit(() => {
 *     cockpit.spawn([ ..., arg ]);
 *   }, [arg]);
 *
 *   ...
 * }
 *
 * The function will be called once during the first render, and
 * whenever "arg" changes.
 *
 * "useInit(func, deps, comps)" is the same as "useObject(func, null,
 * deps, comps)" but if you want to emphasize that you just want to
 * run a function (instead of creating a object), it is clearer to use
 * the "useInit" name for that.  Also, "deps" are optional for
 * "useInit" and default to "[]".
 */

export function useInit<T, D extends Tuple>(func: () => T, deps: D, comps?: Comparators<D>, destroy: ((value: T) => void) | null = null): T {
    return useObject(func, destroy, deps || [], comps);
}
