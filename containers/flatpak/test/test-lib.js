/* eslint no-unused-vars: ["error", { "varsIgnorePattern": "ph_.*" }] */
/* simplified subset of test/common/test-functions.js; no sizzle */

window.cur_doc = document;

async function ph_switch_to_frame(frame) {
    window.cur_doc = document;
    if (frame) {
        const frame_sel = "iframe[name='cockpit1:localhost/" + frame + "'][data-loaded]";
        await ph_wait_present(frame_sel);
        window.cur_doc = document.querySelector(frame_sel).contentWindow.document;
    }
}

function ph_wait_cond(cond, timeout, error_description) {
    return new Promise((resolve, reject) => {
        // poll every 100 ms for now;  FIXME: poll less often and re-check on mutations using
        // https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver
        let stepTimer = null;
        const tm = window.setTimeout(() => {
            if (stepTimer)
                window.clearTimeout(stepTimer);
            reject(new Error(error_description));
        }, timeout);
        function step() {
            try {
                if (cond()) {
                    window.clearTimeout(tm);
                    resolve();
                    return;
                }
            } catch (err) {
                reject(err);
            }
            stepTimer = window.setTimeout(step, 100);
        }
        step();
    });
}

function ph_wait_present(sel) {
    return ph_wait_cond(() => (window.cur_doc.querySelector(sel) != null), 10000, "timed out waiting for " + sel);
}

function ph_wait_not_present(sel) {
    return ph_wait_cond(() => (window.cur_doc.querySelector(sel) === null), 10000, "timed out waiting for " + sel + " to disappear");
}

function ph_wait_visible(sel) {
    return ph_wait_cond(() => {
        const el = window.cur_doc.querySelector(sel);
        if (el === null)
            return false;
        return el.tagName == "svg" || ((el.offsetWidth > 0 || el.offsetHeight > 0) && !(el.style.visibility == "hidden" || el.style.display == "none"));
    }, 10000, "timed out waiting for " + sel + " to be visible");
}

function ph_wait_not_visible(sel) {
    return ph_wait_cond(() => {
        const el = window.cur_doc.querySelector(sel);
        if (el === null)
            return true;
        return !(el.tagName == "svg" || ((el.offsetWidth > 0 || el.offsetHeight > 0) && !(el.style.visibility == "hidden" || el.style.display == "none")));
    }, 10000, "timed out waiting for " + sel + " to be visible");
}

function ph_wait_in_text(sel, match) {
    return ph_wait_cond(() => window.cur_doc.querySelector(sel).textContent.includes(match),
                        1000, `timed out waiting for ${sel} to contain ${match}`);
}

function ph_wait_count(sel, count) {
    return ph_wait_cond(() => (window.cur_doc.querySelectorAll(sel).length === count), 10000, "timed out waiting for " + sel + " to be visible");
}

function ph_mouse(sel, type, x, y, btn, ctrlKey, shiftKey, altKey, metaKey) {
    const el = window.cur_doc.querySelector(sel);

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
        screenX: left + (x || 0),
        screenY: top + (y || 0),
        clientX: left + (x || 0),
        clientY: top + (y || 0),
        button: btn || 0,
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

// call this at each async test exit path, check expected values in run-js caller
function ph_set_result(value) {
    window.webkit.messageHandlers.result.postMessage(value.toString());
}
