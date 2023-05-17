/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2022 Red Hat, Inc.
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

function debug() {
    if (window.debugging == "all" || window.debugging?.includes("style")) {
        console.debug([`cockpit-dark-theme: ${document.documentElement.id}:`, ...arguments].join(" "));
    }
}

function changeDarkThemeClass(documentElement, dark_mode) {
    debug(`Setting cockpit theme to ${dark_mode ? "dark" : "light"}`);

    if (dark_mode) {
        documentElement.classList.add('pf-v5-theme-dark');
    } else {
        documentElement.classList.remove('pf-v5-theme-dark');
    }
}

function _setDarkMode(_style) {
    const style = _style || localStorage.getItem('shell:style') || 'auto';
    let dark_mode;
    // If a user set's an explicit theme, ignore system changes.
    if ((window.matchMedia?.('(prefers-color-scheme: dark)').matches && style === "auto") || style === "dark") {
        dark_mode = true;
    } else {
        dark_mode = false;
    }
    changeDarkThemeClass(document.documentElement, dark_mode);
}

window.addEventListener("storage", event => {
    if (event.key === "shell:style") {
        debug(`Storage element 'shell:style' changed from  ${event.oldValue} to ${event.newValue}`);

        _setDarkMode();
    }
});

// When changing the theme from the shell switcher the localstorage change will not fire for the same page (aka shell)
// so we need to listen for the event on the window object.
window.addEventListener("cockpit-style", event => {
    const style = event.detail.style;
    debug(`Event received from shell with 'cockpit-style'  ${style}`);

    _setDarkMode(style);
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    debug(`Operating system theme preference changed to ${window.matchMedia?.('(prefers-color-scheme: dark)').matches ? "dark" : "light"}`);
    _setDarkMode();
});

_setDarkMode();
