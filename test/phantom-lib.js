// No magic here.

function ph_init ()
{
}

function ph_find (sel)
{
    var $sel = $(sel);
    if ($sel.length == 0)
        throw sel + " not found";
    if ($sel.length > 1)
        throw sel + " is ambigous";
    return $sel;
}

function ph_val (sel)
{
    return ph_find(sel).val();
}

function ph_set_val (sel, val)
{
    ph_find(sel).val(val).trigger('change');
}

function ph_has_val (sel, val)
{
    return ph_find(sel).val() == val;
}

function ph_text (sel)
{
    return ph_find(sel).text();
}

function ph_attr (sel, attr)
{
    return ph_find(sel).attr(attr);
}

function ph_set_attr (sel, attr, val)
{
    ph_find(sel).attr(attr, val).trigger('change');
}

function ph_click (sel)
{
    ph_find(sel).click();
}

function ph_set_checked (sel, val)
{
    ph_find(sel).attr('checked', val).trigger('change');
}

function ph_is_visible (sel)
{
    var $sel = ph_find(sel);
    return $sel.is(':visible') && !$sel.is(':animated');
}

function ph_in_text (sel, text)
{
    return ph_find(sel).text().indexOf(text) != -1;
}

function ph_text_is (sel, text)
{
    return ph_find(sel).text() == text;
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
    client_options.protocol = "dbus-json1";
    var client = cockpit.dbus(client_address, client_options);
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
    var client = cockpit.dbus(client_address, client_options);
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
    var client = cockpit.dbus(client_address, client_options);
    var proxy = client.lookup(path, iface);
    var result = proxy && proxy[prop] == text;
    client.release()
    return result;
}
