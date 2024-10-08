/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2024 Red Hat, Inc.
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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

/* This is the React component that renders all the iframes for the
   pages.

   We can't let React itself manipulate the iframe DOM elements,
   unfortunately, for these reasons:

   - We need to be super careful when setting the "src" attribute of
     an iframe element. Otherwise we get spurious browsing history
     entries that cause the Back button of browsers to behave
     erratically.

   - We need to adjust the window and document inside the iframe a bit.

   Thus, we use a giant useEffect hook to reimplement the incremental
   DOM updates that React would do for us.
*/

import React, { useRef, useEffect } from 'react';

export const Frames = ({ state, idle_state, hidden }) => {
    const content_ref = useRef(null);
    const { frames, current_frame } = state;

    useEffect(() => {
        const content = content_ref.current;
        if (!content)
            return;

        function iframe_remove(elt) {
            elt.remove();
        }

        function iframe_new(name) {
            const elt = document.createElement("iframe");
            elt.setAttribute("name", name);
            elt.style.display = "none";
            content.appendChild(elt);
            return elt;
        }

        function setup_iframe(frame, iframe) {
            idle_state.setupIdleResetEventListeners(iframe.contentWindow);
            iframe.contentWindow.addEventListener("unload", () => teardown_iframe(frame, iframe), { once: true });

            if (iframe.contentDocument && iframe.contentDocument.documentElement) {
                iframe.contentDocument.documentElement.lang = state.config.language;
                if (state.config.language_direction)
                    iframe.contentDocument.documentElement.dir = state.config.language_direction;
            }

            if (!frame.ready) {
                frame.ready = true;
                state.update();
            }
        }

        function teardown_iframe(frame, iframe) {
            if (frame.ready) {
                frame.ready = false;
                state.update();
            }
        }

        const iframes_by_name = {};

        for (const c of content.children) {
            if (c.nodeName == "IFRAME" && c.getAttribute('name')) {
                iframes_by_name[c.getAttribute('name')] = c;
            }
        }

        // Remove obsolete iframes
        for (const name in iframes_by_name) {
            if (!frames[name] || frames[name].url == null)
                iframe_remove(iframes_by_name[name]);
        }

        // Add new and update existing iframes
        for (const name in frames) {
            const frame = frames[name];
            if (!frame.url)
                continue;

            let iframe = iframes_by_name[name];

            if (!iframe) {
                iframe = iframe_new(name);
                iframe.setAttribute("class", "container-frame");
                iframe.setAttribute("data-host", frame.host);
                iframe.addEventListener("load", () => setup_iframe(frame, iframe));
            }

            if (iframe.getAttribute("title") != frame.title)
                iframe.setAttribute("title", frame.title);

            if (frame.loaded && iframe.getAttribute("data-loaded") == null)
                iframe.setAttribute("data-loaded", "1");
            else if (!frame.loaded && iframe.getAttribute("data-loaded"))
                iframe.removeAttribute("data-loaded");

            const src = frame.url + "#" + frame.hash;

            if (iframe.getAttribute('src') != src) {
                if (iframe.contentWindow) {
                    // This prevents the browser from creating a new
                    // history entry.  It would do that whenever the "src"
                    // of a frame is changed and the window location is
                    // not consistent with the new "src" value.
                    //
                    // This matters when a "jump" command changes both
                    // the current frame and the hash of the newly
                    // current frame.
                    iframe.contentWindow.location.replace(src);
                }
                iframe.setAttribute('src', src);
            }

            iframe.style.display = (!hidden && frame == current_frame && frame.ready) ? "block" : "none";
        }
    });

    return <div ref={content_ref}
                id="content"
                className="area-ct-content"
                role="main"
                tabIndex="-1" />;
};
