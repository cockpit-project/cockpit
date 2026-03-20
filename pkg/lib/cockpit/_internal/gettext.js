/*
 * Copyright (C) 2014 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

/* ---------------------------------------------------------------------
 * Localization
 */

let po_data = { };
let po_plural;

const test_l10n = window.localStorage.test_l10n;

export let language = "en";
export let language_direction = "ltr";

export function locale(po) {
    let lang = language;
    let lang_dir = language_direction;
    let header;

    if (po) {
        Object.assign(po_data, po);
        header = po[""];
    } else if (po === null) {
        po_data = { };
    }

    if (header) {
        if (header["plural-forms"])
            po_plural = header["plural-forms"];
        if (header.language)
            lang = header.language;
        if (header["language-direction"])
            lang_dir = header["language-direction"];
    }

    language = lang;
    language_direction = lang_dir;
}

export function translate(/* ... */) {
    let what;

    /* Called without arguments, entire document */
    if (arguments.length === 0)
        what = [document];

    /* Called with a single array like argument */
    else if (arguments.length === 1 && arguments[0].length)
        what = arguments[0];

    /* Called with 1 or more element arguments */
    else
        what = arguments;

    /* Translate all the things */
    const wlen = what.length;
    for (let w = 0; w < wlen; w++) {
        /* The list of things to translate */
        let list = null;
        if (what[w].querySelectorAll)
            list = what[w].querySelectorAll("[translate]");
        if (!list)
            continue;

        /* Each element */
        for (let i = 0; i < list.length; i++) {
            const el = list[i];

            let val = el.getAttribute("translate") || "yes";
            if (val == "no")
                continue;

            /* Each thing to translate */
            const tasks = val.split(" ");
            val = el.getAttribute("translate-context") || el.getAttribute("context");
            for (let t = 0; t < tasks.length; t++) {
                if (tasks[t] == "yes" || tasks[t] == "translate")
                    el.textContent = gettext(val, el.textContent);
                else if (tasks[t])
                    el.setAttribute(tasks[t], gettext(val, el.getAttribute(tasks[t]) || ""));
            }

            /* Mark this thing as translated */
            el.removeAttribute("translate");
        }
    }
}

export function gettext(context, string) {
    /* Missing first parameter */
    if (arguments.length == 1) {
        string = context;
        context = undefined;
    }

    const key = context ? context + '\u0004' + string : string;
    if (po_data) {
        const translated = po_data[key];
        if (translated?.[1])
            string = translated[1];
    }

    if (test_l10n === 'true')
        return "»" + string + "«";

    return string;
}

function imply(val) {
    return (val === true ? 1 : val || 0);
}

export function ngettext(context, string1, stringN, num) {
    /* Missing first parameter */
    if (arguments.length == 3) {
        num = stringN;
        stringN = string1;
        string1 = context;
        context = undefined;
    }

    const key = context ? context + '\u0004' + string1 : string1;
    if (po_data && po_plural) {
        const translated = po_data[key];
        if (translated) {
            const i = imply(po_plural(num)) + 1;
            if (translated[i])
                return translated[i];
        }
    }
    if (num == 1)
        return string1;
    return stringN;
}

export const _ = gettext;
