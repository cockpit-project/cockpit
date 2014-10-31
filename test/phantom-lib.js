/*
 * These are routines used by our testing code.
 *
 * jQuery is not necesarily present. Don't rely on it
 * for routine operations.
 */

function ph_init ()
{
}

function ph_select(sel)
{
    if (window.$)
        return $(sel);

    if (sel.indexOf(':') != -1 ||
        sel.indexOf('(') != -1 ||
        sel.indexOf(')') != -1 ||
        sel.indexOf('"') != -1 ||
        sel.indexOf("'") != -1)
        throw "cannot use selector without jQuery: " + sel;

    if (sel.indexOf('#') === 0) {
        var el = document.getElementById(sel.substring(1));
        if (!el)
            return [ ];
        return [ el ];
    }

    var els;
    if (sel.indexOf('.'))
        els = document.getElementsByClassName(sel.substring(1));
    else
        els = document.getElementsByTagName(sel);
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

function ph_click (sel)
{
    var ev = document.createEvent("MouseEvent");
    ev.initMouseEvent(
            "click",
            true /* bubble */, true /* cancelable */,
            window, null,
            0, 0, 0, 0, /* coordinates */
            false, false, false, false, /* modifier keys */
            0 /*left*/, null);
    ph_find(sel).dispatchEvent(ev);
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
    if (window.$) {
        var $sel = ph_select(sel);
        ph_only($sel, sel);
        return $sel.is(':visible') && !$sel.is(':animated');
    } else {
        var el = ph_find(sel);
        return (el.offsetParent !== null);
    }
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

function ph_go (hash)
{
    window.location.hash = hash;
}

function ph_focus(sel)
{
    ph_find(sel).focus();
}

function ph_dbus_ready (client_address, client_options)
{
    client_options.payload = "dbus-json1";
    /* TODO: This needs to be migrated away from the old dbus */
    var client = cockpit.dbusx(client_address, client_options);
    var result = client && client.state == "ready";
    client.release();
    return result;
}

function ph_dbus_prop (client_address, client_options, iface, prop, text)
{
    // check whether there is any object that has the given text as
    // the value of the given property

    var result = false;
    client_options.protocol = "dbus-json1";
    /* TODO: This needs to be migrated away from the old dbus */
    var client = cockpit.dbusx(client_address, client_options);
    var objs = client.getObjectsFrom("/");
    for (var i = 0; i < objs.length; i++) {
        var obj_iface = objs[i].lookup(iface);
        if (obj_iface && obj_iface[prop] && obj_iface[prop] == text) {
            result = objs[i].objectPath;
            break;
        }
    }
    client.release()
    return result;
}

function ph_dbus_object_prop (client_address, client_options, path, iface, prop, text)
{
    // check whether the given property has the given value

    client_options.protocol = "dbus-json1";
    /* TODO: This needs to be migrated away from the old dbus */
    var client = cockpit.dbusx(client_address, client_options);
    var proxy = client.lookup(path, iface);
    var result = proxy && proxy[prop] == text;
    client.release()
    return result;
}
