/* global somefunction welderApiHost:true */
/* global somefunction welderApiScheme:true */
/* global somefunction welderApiPort:true */
/* global somefunction welderApiRelative:true */ // eslint-disable-line no-unused-vars

let cockpit;
let cockpitHttp;

welderApiHost = welderApiHost || 'localhost';
welderApiScheme = welderApiScheme || 'http';

function setupCockpitHttp() {
  const useHttps = welderApiScheme === 'https';
  const port = welderApiPort || (useHttps ? 443 : 80);
  cockpitHttp = cockpit.http(port, {
    address: welderApiHost,
    tls: useHttps ? {} : undefined,
  });
}

function cockpitFetch(url, options, skipDecode) {
  if (!options) { options = {}; } // eslint-disable-line no-param-reassign
  if (!options.method) { options.method = 'GET'; } // eslint-disable-line no-param-reassign
  if (!options.body) { options.body = ''; } // eslint-disable-line no-param-reassign

  options.path = url; // eslint-disable-line no-param-reassign

  if (!cockpitHttp) { setupCockpitHttp(); }

  return new Promise((resolve) => {
    cockpitHttp.request(options)
        .then((data) => {
          if (skipDecode) { resolve(data); } else { resolve(JSON.parse(data)); }
        });
  });
}

function createUrl(url) {
  // API is hosted on the same URL as the UI
  if (welderApiRelative === true) {
    return url;
  }

  const parser = document.createElement('a');
  parser.href = url;
  parser.scheme = welderApiScheme;
  parser.host = welderApiHost;
  if (welderApiPort) { parser.port = welderApiPort; }
  return parser.href;
}

function apiFetch(url, options, skipDecode) {
  const fullUrl = createUrl(url);
  return new Promise((resolve) => {
    fetch(fullUrl, options)
      .then((r) => {
        if (skipDecode) { resolve(r); } else { resolve(r.json()); }
      });
  });
}

const module = { apiFetch };
if (window.location.href.indexOf('cockpit') > -1) {
  cockpit = require('cockpit'); // eslint-disable-line global-require, import/no-unresolved
  module.apiFetch = cockpitFetch;
  module.inCockpit = true;
}

export default module;
