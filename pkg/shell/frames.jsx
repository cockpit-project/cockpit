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
   unfortunately, for two reasons:

   - We need to be super careful when setting the "src" attribute of
     an iframe element. Otherwise we get spurious browsing history
     entries that cause the Back button of browsers to behave
     erratically.

   - At least Chromium 128.0.6613.137 crashes when our iframe elements
     are removed from the DOM.

   Thus, we use a giant useEffect hook to reimplement the incremental
   DOM updates that React would do for us.
*/

import React, { useRef, useEffect } from 'react';

function poll_frame_ready(state, frame, elt, count, setupFrameWindow) {
    let ready = false;

    try {
        if (elt.contentWindow.document && elt.contentWindow.document.body) {
            ready = (elt.contentWindow.location.href != "about:blank" &&
                     elt.contentWindow.document.body.offsetWidth > 0 &&
                     elt.contentWindow.document.body.offsetHeight > 0);
        }
    } catch (ex) {
        ready = true;
    }

    if (!count)
        count = 0;

    count += 1;
    if (count > 50)
        ready = true;

    if (ready) {
        if (!frame.ready) {
            frame.ready = true;
            state.update();
        }

        if (elt.contentWindow && setupFrameWindow)
            setupFrameWindow(elt.contentWindow);

        if (elt.contentDocument && elt.contentDocument.documentElement) {
            elt.contentDocument.documentElement.lang = state.config.language;
            if (state.config.language_direction)
                elt.contentDocument.documentElement.dir = state.config.language_direction;
        }
    } else {
        window.setTimeout(function() {
            poll_frame_ready(state, frame, elt, count + 1, setupFrameWindow);
        }, 100);
    }
}

export const Frames = ({ state, idle_state, hidden }) => {
    const content_ref = useRef(null);
    const { frames, current_frame } = state;

    useEffect(() => {
        const content = content_ref.current;
        if (!content)
            return;

        const free_iframes = [];

        function iframe_remove(elt) {
            // XXX - chromium crashes somewhere down the line when
            // removing iframes here. So we strip them of their
            // attributes, put them on a list, and reuse them
            // eventually.
            console.log("REMOVE IFRAME", elt.getAttribute('name'));
            state.router.unregister_name(elt.getAttribute('name'));
            elt.removeAttribute('name');
            elt.removeAttribute('title');
            elt.removeAttribute('src');
            elt.removeAttribute('data-host');
            elt.removeAttribute("data-ready");
            elt.removeAttribute("data-loaded");
            elt.removeAttribute('class');
            elt.style.display = "none";
            free_iframes.push(elt);
        }

        function iframe_new(name) {
            let elt = free_iframes.shift();
            if (!elt) {
                elt = document.createElement("iframe");
                elt.setAttribute("name", name);
                elt.style.display = "none";
                content.appendChild(elt);
            } else {
                elt.setAttribute("name", name);
                elt.contentWindow.name = name;
            }
            return elt;
        }

        const iframes_by_name = {};

        for (const c of content.children) {
            if (c.nodeName == "IFRAME") {
                if (c.getAttribute('name'))
                    iframes_by_name[c.getAttribute('name')] = c;
                else
                    free_iframes.push(c);
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
                console.log("NEW IFRAME", name);
                iframe.setAttribute("class", "container-frame");
                iframe.setAttribute("data-host", frame.host);
            }

            if (iframe.getAttribute("title") != frame.title)
                iframe.setAttribute("title", frame.title);

            if (frame.ready && iframe.getAttribute("data-ready") == null)
                iframe.setAttribute("data-ready", "1");
            else if (!frame.ready && iframe.getAttribute("data-ready"))
                iframe.removeAttribute("data-ready");

            if (frame.loaded && iframe.getAttribute("data-loaded") == null)
                iframe.setAttribute("data-loaded", "1");
            else if (!frame.loaded && iframe.getAttribute("data-loaded"))
                iframe.removeAttribute("data-loaded");

            const src = frame.url + "#" + frame.hash;

            if (iframe.getAttribute('src') != src) {
                console.log("SRC", name, iframe.getAttribute('src'), "->", src);

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

                poll_frame_ready(state, frame, iframe, 0, win => idle_state.setupIdleResetEventListeners(win));
            }

            iframe.style.display = (!hidden && frame == current_frame) ? "block" : "none";

            // This makes the initial "about:blank" document of the
            // iframe dark if necessary, to avoid some flickering.
            //
            // NOTE: This works well with Chrome, but not with
            // Firefox, which seems to create a couple of new
            // documentElements as time goes on, and they all start
            // out white.
            if (!iframes_by_name[name] && iframe.contentDocument.documentElement) {
                const style = localStorage.getItem('shell:style') || 'auto';
                if ((window.matchMedia &&
                     window.matchMedia('(prefers-color-scheme: dark)').matches &&
                     style === "auto") ||
                    style === "dark") {
                    // --pf-v5-global--BackgroundColor--dark-300
                    iframe.contentDocument.documentElement.style.background = '#1b1d21';
                } else {
                    iframe.contentDocument.documentElement.style.background = 'white';
                }
            }
        }
    });

    return <div ref={content_ref}
                id="content"
                className="area-ct-content"
                role="main"
                tabIndex="-1" />;
};
