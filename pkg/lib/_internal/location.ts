function get_url_root(): string | null {
    const meta_url_root = document.head.querySelector("meta[name='url-root']");
    if (meta_url_root instanceof HTMLMetaElement) {
        return meta_url_root.content.replace(/^\/+|\/+$/g, '');
    } else {
        // fallback for cockpit-ws < 272
        try {
            // Sometimes this throws a SecurityError such as during testing
            return window.localStorage.getItem('url-root');
        } catch (e) {
            return null;
        }
    }
}
export const url_root = get_url_root();

export const transport_origin = window.location.origin;

export function calculate_application(): string {
    let path = window.location.pathname || "/";
    let _url_root = url_root;
    if (window.mock?.pathname)
        path = window.mock.pathname;
    if (window.mock?.url_root)
        _url_root = window.mock.url_root;

    if (_url_root && path.indexOf('/' + _url_root) === 0)
        path = path.replace('/' + _url_root, '') || '/';

    if (path.indexOf("/cockpit/") !== 0 && path.indexOf("/cockpit+") !== 0) {
        if (path.indexOf("/=") === 0)
            path = "/cockpit+" + path.split("/")[1];
        else
            path = "/cockpit";
    }

    return path.split("/")[1];
}

export function calculate_url(suffix?: string): string {
    if (!suffix)
        suffix = "socket";
    const window_loc = window.location.toString();
    let _url_root = url_root;

    if (window.mock?.url)
        return window.mock.url;
    if (window.mock?.url_root)
        _url_root = window.mock.url_root;

    let prefix = calculate_application();
    if (_url_root)
        prefix = _url_root + "/" + prefix;

    if (window_loc.indexOf('http:') === 0) {
        return "ws://" + window.location.host + "/" + prefix + "/" + suffix;
    } else if (window_loc.indexOf('https:') === 0) {
        return "wss://" + window.location.host + "/" + prefix + "/" + suffix;
    } else {
        throw new Error("Cockpit must be used over http or https");
    }
}
