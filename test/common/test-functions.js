/*
 * These are routines used by our testing code.
 *
 * jQuery is not necessarily present. Don't rely on it
 * for routine operations.
 */

function ph_select(sel) {
    if (!window.Sizzle)
        throw "Sizzle was not properly loaded"
    return window.Sizzle(sel);
}

function ph_only(els, sel)
{
    if (els.length === 0)
        throw sel + " not found";
    if (els.length > 1)
        throw sel + " is ambigous";
    return els[0];
}

function ph_find (sel)
{
    var els = ph_select(sel);
    return ph_only(els, sel);
}

function ph_count(sel) {
    var els = ph_select(sel);
    return els.length;
}

function ph_count_check(sel, expected_num) {
    count = ph_count(sel);
    if (count != expected_num)
        throw "found " + count + " " + sel + " not " + expected_num;
    return count;
}

function ph_val (sel)
{
    var el = ph_find(sel);
    if (el.value === undefined)
        throw sel + " does not have a value";
    return el.value;
}

function ph_set_val (sel, val)
{
    var el = ph_find(sel);
    if (el.value === undefined)
        throw sel + " does not have a value";
    el.value = val;
    var ev = new Event("change", { bubbles: true, cancelable: false });
    el.dispatchEvent(ev);
}

function ph_has_val (sel, val)
{
    return ph_val(sel) == val;
}

function ph_text (sel)
{
    var el = ph_find(sel);
    if (el.textContent === undefined)
        throw sel + " can not have text";
    // 0xa0 is a non-breakable space, which is a rendering detail of Chromium
    // and awkward to handle in tests; turn it into normal spaces
    return el.textContent.replace(/\xa0/g, " ")
}

function ph_attr (sel, attr)
{
    return ph_find(sel).getAttribute(attr);
}

function ph_set_attr (sel, attr, val)
{
    var el = ph_find(sel);
    if (val === null || val === undefined)
        el.removeAttribute(attr);
    else
        el.setAttribute(attr, val);

    var ev = new Event("change", { bubbles: true, cancelable: false });
    el.dispatchEvent(ev);
}

function ph_has_attr (sel, attr, val)
{
    return ph_attr(sel, attr) == val;
}

function ph_attr_contains (sel, attr, val)
{
    return ph_attr(sel, attr).indexOf(val) > -1;
}

function ph_mouse(sel, type, x, y, btn, force) {
    let el = ph_find(sel);

    /* The element has to be visible, and not collapsed */
    if (!force && el.offsetWidth <= 0 && el.offsetHeight <= 0)
        throw sel + " is not visible";

    /* The event has to actually work */
    var processed = false;
    function handler() {
        processed = true;
    }

    el.addEventListener(type, handler, true);

    let elp = el;
    let left = elp.offsetLeft;
    let top = elp.offsetTop;
    while (elp.offsetParent) {
        elp = elp.offsetParent;
        left += elp.offsetLeft;
        top += elp.offsetTop;
    }

    var detail = 0;
    if (["click", "mousedown", "mouseup"].indexOf(type) > -1)
        detail = 1;
    else if (type === "dblclick")
        detail = 2;

    var ev = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        detail: detail,
        screenX: left + x,
        screenY: top + y,
        clientX: left + x,
        clientY: top + y,
        button: btn
    });

    el.dispatchEvent(ev);

    el.removeEventListener(type, handler, true);

    /* It really had to work */
    if (!processed)
        throw sel + " is disabled or somehow doesn't process events";
}

function ph_set_checked (sel, val)
{
    var el = ph_find(sel);
    if (el.checked === undefined)
        throw sel + " is not checkable";

    if (el.checked != val)
        ph_mouse(sel, "click", 0, 0, 0, true);
}

function ph_is_visible (sel)
{
    var el = ph_find(sel);
    return (el.offsetWidth > 0 || el.offsetHeight > 0) && !(el.style.visibility == "hidden" || el.style.display == "none");
}

function ph_is_present(sel)
{
    var els = ph_select(sel);
    return els.length > 0;
}

function ph_in_text (sel, text)
{
    return ph_text(sel).indexOf(text) != -1;
}

function ph_text_is (sel, text)
{
    return ph_text(sel) == text;
}

function ph_go(href) {
    if (href.indexOf("#") === 0) {
        window.location.hash = href;

    } else {
        if (window.name.indexOf("cockpit1") !== 0)
            throw "ph_go() called in non cockpit window";
        var control = {
            command: "jump",
            location: href
        };
        window.parent.postMessage("\n" + JSON.stringify(control), "*");
    }
}

function ph_focus(sel)
{
    ph_find(sel).focus();
}

function ph_blur(sel)
{
    ph_find(sel).blur();
}

class PhWaitCondTimeout extends Error {
    constructor() {
        super("condition did not become true");
    }
}

function ph_wait_cond(cond, timeout) {
    return new Promise((resolve, reject) => {
        // poll every 100 ms for now;  FIXME: poll less often and re-check on mutations using
        // https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver
        let stepTimer = null;
        let tm = window.setTimeout( () => {
                if (stepTimer)
                    window.clearTimeout(stepTimer);
                reject(new PhWaitCondTimeout());
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
