import 'babel-polyfill';
import 'whatwg-fetch';

import React from 'react';  // eslint-disable-line no-unused-vars
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import 'bootstrap-select';

import store from './core/store';
import router from './core/router';
import history from './core/history';

let routes = require('./routes.json'); // Loaded with utils/routes-loader.js
const container = document.getElementById('main');

function renderComponent(component) {
  ReactDOM.render(<Provider store={store}>{component}</Provider>, container);
}

// Find and render a web page matching the current URL path,
// if such page is not found then render an error page (see routes.json, core/router.js)
function render(location) {
  router.resolve(routes, location)
    .then(renderComponent)
    .catch(error => router.resolve(routes, Object.assign ({}, location, { error: error })).then(renderComponent));
}

// Handle client-side navigation by using HTML5 History API
// For more information visit https://github.com/ReactJSTraining/history/tree/master/docs#readme
history.listen(render);
render(history.getCurrentLocation());
