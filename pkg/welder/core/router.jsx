import React from 'react';

function decodeParam(val) {
  if (!(typeof val === 'string' || val.length === 0)) {
    return val;
  }

  try {
    return decodeURIComponent(val);
  } catch (err) {
    if (err instanceof URIError) {
      err.message = `Failed to decode param '${val}'`;
      err.status = 400;
    }

    throw err;
  }
}

// Match the provided URL path pattern to an actual URI string. For example:
//   matchURI({ path: '/posts/:id' }, '/dummy') => null
//   matchURI({ path: '/posts/:id' }, '/posts/123') => { id: 123 }
function matchURI(route, path) {
  const match = route.pattern.exec(path);

  if (!match) {
    return null;
  }

  const params = Object.create(null);

  for (let i = 1; i < match.length; i++) {
    params[route.keys[i - 1].name] = match[i] !== undefined ? decodeParam(match[i]) : undefined;
  }

  return params;
}

// Find the route matching the specified location (context), fetch the required data,
// instantiate and return a React component
function resolve(routes, context) {
  for (const route of routes) {
    const params = matchURI(route, context.error ? '/error' : context.pathname);

    if (!params) {
      continue;
    }

    // Check if the route has any data requirements, for example:
    // { path: '/tasks/:id', data: { task: 'GET /api/tasks/$id' }, page: './pages/task' }
    if (route.data) {
      // Load page component and all required data in parallel
      const keys = Object.keys(route.data);
      return Promise.all([
        route.load(),
        ...keys.map(key => {
          const query = route.data[key];
          const method = query.substring(0, query.indexOf(' ')); // GET
          let url = query.substr(query.indexOf(' ') + 1);      // /api/tasks/$id
          // TODO: Optimize
          Object.keys(params).forEach((k) => {
            url = url.replace(`${k}`, params[k]);
          });
          return fetch(url, { method, credentials: 'same-origin' }).then(resp => resp.json());
        }),
      ]).then(([Page, ...data]) => {
        const props = keys.reduce((result, key, i) => (Object.assign({}, result, { [key]: data[i] })), {});
        return <Page route={Object.assign({}, route, { params: params })} error={context.error} {...props} />;
      });
    }

    return route.load().then(Page => <Page route={Object.assign({}, route, { params: params })} error={context.error} />);
  }

  const error = new Error('Page not found');
  error.status = 404;
  return Promise.reject(error);
}

export default { resolve };
