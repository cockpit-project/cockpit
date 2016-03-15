/*
 * These are routines used by our testing code.
 *
 * jQuery is not necesarily present. Don't rely on it
 * for routine operations.
 */

localStorage.clear();

function ph_select(sel) {
    var list, i, els = [];
    if (window.jQuery)
        list = window.jQuery(sel);
    else
        list = document.querySelectorAll(sel);
    for (i = 0; i < list.length; i++)
        els.push(list[i]);
    return els;
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
    var ev = document.createEvent("Event");
    ev.initEvent("change", true, false);
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
    return el.textContent;
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

    var ev = document.createEvent("Event");
    ev.initEvent("change", true, false);
    el.dispatchEvent(ev);
}

function ph_has_attr (sel, attr, val)
{
    return ph_attr(sel, attr) == val;
}

function ph_click(sel, force) {
    var el = ph_find(sel);

    /* The element has to be visible, and not collapsed */
    if (!force && (el.offsetWidth <= 0 || el.offsetHeight <= 0))
        throw sel + " is not visible";

    var ev = document.createEvent("MouseEvent");
    ev.initMouseEvent(
        "click",
        true /* bubble */, true /* cancelable */,
        window, null,
        0, 0, 0, 0, /* coordinates */
        false, false, false, false, /* modifier keys */
        0 /*left*/, null);

    /* The click has to actually work */
    var clicked = false;
    function click() {
        clicked = true;
    }

    el.addEventListener("click", click, true);

    /* Now dispatch the event */
    el.dispatchEvent(ev);

    el.removeEventListener("click", click, true);

    /* It really had to work */
    if (!clicked)
        throw sel + " is disabled or somehow not clickable";
}

function ph_set_checked (sel, val)
{
    var el = ph_find(sel);
    if (el.checked === undefined)
        throw sel + " is not checkable";
    el.checked = val;

    var ev = document.createEvent("Event");
    ev.initEvent("change", true, false);
    el.dispatchEvent(ev);
}

function ph_is_visible (sel)
{
    var el = ph_find(sel);
    return (el.offsetWidth > 0 || el.offsetHeight > 0) && el.style.visibility != "hidden";
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
