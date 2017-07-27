/* global window, cockpit, RFB, WebUtil, $D */

/*
 * These are modules that both global and noVNC code expect to use,
 * but only use them via their entry points. They are not nodejs
 * style modules, so we need to use the exports loader to get the
 * right exported object out of their scopes.
 */
window.Util = require("exports?Util!noVNC/include/util.js");
window.WebUtil = require("exports?WebUtil!noVNC/include/webutil.js");

/*
 * This is a real nodejs module.expotrs form, which other code
 * then expects to use. We must export it globally
 */
window.inflator = require("noVNC/include/inflator.js");

/*
 * This is a hodgepodge of old-school javascript with hundreds of
 * interdependencies between files. We concatenate them with our custom
 * cat.js webpack loader.
 */
window.RFB = require("exports?RFB!./cat?noVNC/include/base64.js&noVNC/include/websock.js&noVNC/include/des.js&noVNC/include/keysymdef.js&noVNC/include/keyboard.js&noVNC/include/input.js&noVNC/include/display.js&noVNC/include/rfb.js!noVNC/include/keysym.js");

var rfb;
var resizeTimeout;

function ensureVisibility() {
    window.setTimeout(function () {
        var containerId = decodeURIComponent(WebUtil.getConfigVar("containerId", ""));
        console.log("Scrolling VNC frame into view, containerId = ", containerId);

        var toBeVisible = window.parent.document.querySelector("tr[data-row-id='" + containerId + "']");
        var toBeVisibleRow = window.parent.document.getElementById(containerId + "-row");

        if (toBeVisible && toBeVisibleRow && toBeVisible.scrollIntoView) {
            toBeVisible.scrollIntoView(); // ensure maximal visibility of the VNC iframe + VM-controls
            toBeVisibleRow.scrollIntoView(); // ensure the VM's name is visible
        } else {
            console.log('scrollIntoView() is not supported');
        }
    }, 50);
}

function UIresize() {
    var containerId = decodeURIComponent(WebUtil.getConfigVar('containerId', ''));
    if (!containerId) {
        console.error("containerId not found in noVNC frame params!");
        return ;
    }

    // Normally, the frame/container size shall resize the VM.
    // Since this is not working, let's do it vice-versa: adapt browser's component height according to inner display's size.
    // Another workaround is in canvas resizing which effectively leads to scaling. But this seems not look good.
    if (WebUtil.getConfigVar('resize', false)) {
        var height = ($D('noVNC_canvas').height + 60)+ "px";
        console.log('Resizing noVNC, height = ', height);

        var novncContainerId = containerId + "-novnc-frame-container";
        var novncContainer = window.parent.document.getElementById(novncContainerId);
        if (novncContainer)
            novncContainer.style.height = height;

        // no need to resize width - already 100%, potential scrollbar

        ensureVisibility();
    }
}

function FBUComplete(rfb, fbu) {
    UIresize();
    rfb.set_onFBUComplete(function() { });
    console.log('Setting focus');
    $D('noVNC_canvas').focus();
}
function passwordRequired(rfb) {
    var msg;
    msg = '<form onsubmit="return setPassword();"';
    msg += '  style="margin-bottom: 0px">';
    msg += 'Password Required: ';
    msg += '<input type=password size=10 id="password_input" class="noVNC_status">';
    msg += '<\/form>';
    $D('noVNC_status_bar').setAttribute("class", "noVNC_status_warn");
    $D('noVNC_status').innerHTML = msg;
}

function sendCtrlAltDel() {
    rfb.sendCtrlAltDel();
    return false;
}

function updateState(rfb, state, oldstate, msg) {
    var s, sb, level;
    s = $D('noVNC_status');
    sb = $D('noVNC_status_bar');
    switch (state) {
        case 'failed':       level = "error";  break;
        case 'fatal':        level = "error";  break;
        case 'normal':       level = "normal"; break;
        case 'disconnected': level = "normal"; break;
        case 'loaded':       level = "normal"; break;
        default:             level = "warn";   break;
    }

    if (typeof(msg) !== 'undefined') {
        sb.setAttribute("class", "noVNC_status_" + level);
        s.textContent = msg;
    }
}

function parseParams() {
    var params = {
        host: WebUtil.getConfigVar('host', 'host not provided in params'),
        port: WebUtil.getConfigVar('port', 'port not provided in params'),
        password: WebUtil.getConfigVar('password', ''),
        encrypt: WebUtil.getConfigVar('encrypt', (window.location.protocol === "https:")),
        true_color: WebUtil.getConfigVar('true_color', true),
        local_cursor: WebUtil.getConfigVar('cursor', true),
        shared: WebUtil.getConfigVar('shared', true),
        view_only: WebUtil.getConfigVar('view_only', false),
        repeaterID: WebUtil.getConfigVar('repeaterID', ''),

        logging: WebUtil.getConfigVar('logging', 'warn'),
        title: WebUtil.getConfigVar('title', 'noVNC'),
    };

    if ((!params.host) || (!params.port)) {
        updateState(null, 'fatal', null, 'Must specify host and port in URL');
        return;
    }

    return params;
}

function connect(path, params) {
    console.log("connecting");
    try {
        rfb = new RFB({
            'target':       $D('noVNC_canvas'),
            'encrypt':      params.encrypt,
            'repeaterID':   params.repeaterID,
            'true_color':   params.true_color,
            'local_cursor': params.local_cursor,
            'shared':       params.shared,
            'view_only':    params.view_only,

            'onUpdateState':  updateState,
            'onXvpInit':    function () {},
            'onPasswordRequired':  passwordRequired,
            'onFBUComplete': FBUComplete});
    } catch (exc) {
        updateState(null, 'fatal', null, 'Unable to create RFB client -- ' + exc);
        return; // don't continue trying to connect
    }

    rfb.connect(window.location.hostname, window.location.port, params.password, path);
}

var params = parseParams();

WebUtil.init_logging(params.logging);
document.title = window.unescape(params.title);

// connect
var query = window.btoa(JSON.stringify({
    payload: "stream",
    protocol: "binary",
    address: params.host,
    port: parseInt(params.port, 10),
    binary: "raw",
}));

cockpit.transport.wait(function () {
    connect("cockpit/channel/" + cockpit.transport.csrf_token + "?" + query, params);
});

window.onresize = function () {
    // When the window has been resized, wait until the size remains
    // the same for 0.5 seconds before sending the request for changing
    // the resolution of the session
    window.clearTimeout(resizeTimeout);
    resizeTimeout = window.setTimeout(function(){
        UIresize();
    }, 500);
};

document.getElementById("vnc-ctrl-alt-del").addEventListener("click", sendCtrlAltDel);
