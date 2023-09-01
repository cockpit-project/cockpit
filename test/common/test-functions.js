/* eslint no-unused-vars: 0 */

/*
 * These are routines used by our testing code.
 *
 * jQuery is not necessarily present. Don't rely on it
 * for routine operations.
 */

function ph_select(sel) {
    if (!window.Sizzle) {
        return Array.from(document.querySelectorAll(sel));
    }

    if (sel.includes(":contains(")) {
        if (!window.Sizzle) {
            throw new Error("Using ':contains' when window.Sizzle is not available.");
        }
        return window.Sizzle(sel);
    } else {
        return Array.from(document.querySelectorAll(sel));
    }
}

function ph_only(els, sel) {
    if (els.length === 0)
        throw new Error(sel + " not found");
    if (els.length > 1)
        throw new Error(sel + " is ambiguous");
    return els[0];
}

function ph_find (sel) {
    const els = ph_select(sel);
    return ph_only(els, sel);
}

function ph_count(sel) {
    const els = ph_select(sel);
    return els.length;
}

function ph_count_check(sel, expected_num) {
    return (ph_count(sel) == expected_num);
}

function ph_val (sel) {
    const el = ph_find(sel);
    if (el.value === undefined)
        throw new Error(sel + " does not have a value");
    return el.value;
}

function ph_set_val (sel, val) {
    const el = ph_find(sel);
    if (el.value === undefined)
        throw new Error(sel + " does not have a value");
    el.value = val;
    const ev = new Event("change", { bubbles: true, cancelable: false });
    el.dispatchEvent(ev);
}

function ph_has_val (sel, val) {
    return ph_val(sel) == val;
}

function ph_collected_text_is (sel, val) {
    const els = ph_select(sel);
    const rest = els.map(el => {
        if (el.textContent === undefined)
            throw new Error(sel + " can not have text");
        return el.textContent.replaceAll("\xa0", " ");
    }).join("");
    return rest === val;
}

function ph_text (sel) {
    const el = ph_find(sel);
    if (el.textContent === undefined)
        throw new Error(sel + " can not have text");
    // 0xa0 is a non-breakable space, which is a rendering detail of Chromium
    // and awkward to handle in tests; turn it into normal spaces
    return el.textContent.replaceAll("\xa0", " ");
}

function ph_attr (sel, attr) {
    return ph_find(sel).getAttribute(attr);
}

function ph_set_attr (sel, attr, val) {
    const el = ph_find(sel);
    if (val === null || val === undefined)
        el.removeAttribute(attr);
    else
        el.setAttribute(attr, val);

    const ev = new Event("change", { bubbles: true, cancelable: false });
    el.dispatchEvent(ev);
}

function ph_has_attr (sel, attr, val) {
    return ph_attr(sel, attr) == val;
}

function ph_attr_contains (sel, attr, val) {
    const a = ph_attr(sel, attr);
    return a && a.indexOf(val) > -1;
}

function ph_mouse(sel, type, x, y, btn, ctrlKey, shiftKey, altKey, metaKey) {
    const el = ph_find(sel);

    /* The element has to be visible, and not collapsed */
    if (el.offsetWidth <= 0 && el.offsetHeight <= 0 && el.tagName != 'svg')
        throw new Error(sel + " is not visible");

    /* The event has to actually work */
    let processed = false;
    function handler() {
        processed = true;
    }

    el.addEventListener(type, handler, true);

    let elp = el;
    let left = elp.offsetLeft || 0;
    let top = elp.offsetTop || 0;
    while (elp.offsetParent) {
        elp = elp.offsetParent;
        left += elp.offsetLeft;
        top += elp.offsetTop;
    }

    let detail = 0;
    if (["click", "mousedown", "mouseup"].indexOf(type) > -1)
        detail = 1;
    else if (type === "dblclick")
        detail = 2;

    const ev = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        detail,
        screenX: left + x,
        screenY: top + y,
        clientX: left + x,
        clientY: top + y,
        button: btn,
        ctrlKey: ctrlKey || false,
        shiftKey: shiftKey || false,
        altKey: altKey || false,
        metaKey: metaKey || false
    });

    el.dispatchEvent(ev);

    el.removeEventListener(type, handler, true);

    /* It really had to work */
    if (!processed)
        throw new Error(sel + " is disabled or somehow doesn't process events");
}

function ph_get_checked (sel) {
    const el = ph_find(sel);
    if (el.checked === undefined)
        throw new Error(sel + " is not checkable");

    return el.checked;
}

function ph_set_checked (sel, val) {
    const el = ph_find(sel);
    if (el.checked === undefined)
        throw new Error(sel + " is not checkable");

    if (el.checked != val)
        ph_mouse(sel, "click", 0, 0, 0);
}

function ph_is_visible (sel) {
    const el = ph_find(sel);
    return el.tagName == "svg" || ((el.offsetWidth > 0 || el.offsetHeight > 0) && !(el.style.visibility == "hidden" || el.style.display == "none"));
}

function ph_is_present(sel) {
    const els = ph_select(sel);
    return els.length > 0;
}

function ph_in_text (sel, text) {
    return ph_text(sel).indexOf(text) != -1;
}

function ph_text_is (sel, text) {
    return ph_text(sel) == text;
}

function ph_text_matches (sel, pattern) {
    return ph_text(sel).match(pattern);
}

function ph_go(href) {
    if (href.indexOf("#") === 0) {
        window.location.hash = href;
    } else {
        if (window.name.indexOf("cockpit1") !== 0)
            throw new Error("ph_go() called in non cockpit window");
        const control = {
            command: "jump",
            location: href
        };
        window.parent.postMessage("\n" + JSON.stringify(control), "*");
    }
}

function ph_focus(sel) {
    ph_find(sel).focus();
}

function ph_scrollIntoViewIfNeeded(sel) {
    ph_find(sel).scrollIntoViewIfNeeded();
}

function ph_blur(sel) {
    ph_find(sel).blur();
}

function ph_blur_active() {
    const elt = window.document.activeElement;
    if (elt)
        elt.blur();
}

class PhWaitCondTimeout extends Error {
    constructor(description) {
        if (description && description.apply)
            description = description.apply();
        if (description)
            super(description);
        else
            super("condition did not become true");
    }
}

function ph_wait_cond(cond, timeout, error_description) {
    return new Promise((resolve, reject) => {
        // poll every 100 ms for now;  FIXME: poll less often and re-check on mutations using
        // https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver
        let stepTimer = null;
        let last_err = null;
        const tm = window.setTimeout(() => {
            if (stepTimer)
                window.clearTimeout(stepTimer);
            reject(last_err || new PhWaitCondTimeout(error_description));
        }, timeout);
        function step() {
            try {
                if (cond()) {
                    window.clearTimeout(tm);
                    resolve();
                    return;
                }
            } catch (err) {
                last_err = err;
            }
            stepTimer = window.setTimeout(step, 100);
        }
        step();
    });
}

function currentFrameAbsolutePosition() {
    let currentWindow = window;
    let currentParentWindow;
    const positions = [];
    let rect;

    while (currentWindow !== window.top) {
        currentParentWindow = currentWindow.parent;
        for (let idx = 0; idx < currentParentWindow.frames.length; idx++)
            if (currentParentWindow.frames[idx] === currentWindow) {
                for (const frameElement of currentParentWindow.document.getElementsByTagName('iframe')) {
                    if (frameElement.contentWindow === currentWindow) {
                        rect = frameElement.getBoundingClientRect();
                        positions.push({ x: rect.x, y: rect.y });
                    }
                }
                currentWindow = currentParentWindow;
                break;
            }
    }

    return positions.reduce((accumulator, currentValue) => {
        return {
            x: accumulator.x + currentValue.x,
            y: accumulator.y + currentValue.y
        };
    }, { x: 0, y: 0 });
}

function flatten(array_of_arrays) {
    if (array_of_arrays.length > 0)
        return Array.prototype.concat.apply([], array_of_arrays);
    else
        return [];
}

function ph_selector_clips(sels) {
    const f = currentFrameAbsolutePosition();
    const elts = flatten(sels.map(ph_select));
    return elts.map(e => {
        const r = e.getBoundingClientRect();
        return { x: r.x + f.x, y: r.y + f.y, width: r.width, height: r.height, scale: 1 };
    });
}

function ph_element_clip(sel) {
    ph_find(sel); // just to make sure it is not ambiguous
    return ph_selector_clips([sel])[0];
}

function ph_count_animations(sel) {
    return ph_find(sel).getAnimations({ subtree: true }).length;
}

function ph_set_texts(new_texts) {
    for (const sel in new_texts) {
        const elts = ph_select(sel);
        if (elts.length == 0)
            throw new Error(sel + " not found");
        for (let elt of elts) {
            // We have to be careful to not replace any actual nodes
            // in the DOM since that would cause React to fail later
            // when it tries to remove some of its nodes that are no
            // longer in the DOM.  This means that setting the
            // "textContent" property is out, for example.
            //
            // Instead, we insist on finding an actual "Text" node
            // that we then modify.  If the given selector results in
            // elements that have other elements in them, we refuse to
            // mock them.
            //
            // However, for convenience, this function digs into
            // elements that have exactly one other child element.
            while (elt.children.length == 1)
                elt = elt.children[0];
            if (elt.children.length != 0)
                throw new Error(sel + " can not be mocked since it contains more than text");
            let subst = new_texts[sel];
            for (const n of elt.childNodes) {
                if (n.nodeType == 3) { // 3 == TEXT
                    n.data = subst;
                    subst = "";
                }
            }
        }
    }
}
